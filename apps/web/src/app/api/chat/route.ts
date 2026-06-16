import OpenAI from "openai";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "openai";
import { z } from "zod";
import { fetchExporterStatus } from "@/lib/fetch-exporter-status";
import {
  buildTelemetryUserMessage,
  CASCADE_INTEL_SYSTEM_PROMPT,
  trimStatusPayload,
} from "@/lib/market-chat-context";
import { FALLBACK_REASONS, resolveMarketChatResponse } from "@/lib/market-chat-engine";
import { statusSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const MAX_HISTORY_MESSAGES = 6;
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000] as const;
const DEFAULT_OPENAI_TIMEOUT_MS = 15000;
const DEFAULT_KIMI_MAX_TOKENS = 1200;

type MarketIntelProvider = "openai" | "kimi";

type MarketIntelConfig = {
  provider: MarketIntelProvider;
  apiKey: string | undefined;
  baseURL?: string;
  primaryModel: string;
  fallbackModel: string;
  timeoutMs: number;
  maxTokens?: number;
  kimiThinking?: "enabled" | "disabled";
};

type StreamingPayload = {
  chatMessages: OpenAI.ChatCompletionMessageParam[];
  responsesInput: OpenAI.Responses.ResponseInput;
};

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(50),
  telemetrySnapshot: statusSchema.nullable().optional(),
});

type ChatMessage = z.infer<typeof chatMessageSchema>;

type FallbackPayload = {
  response: string;
  fallbackReason: string;
  telemetryAgeMs: number;
};

function jsonFallback(payload: FallbackPayload) {
  return Response.json(payload, {
    headers: {
      ...NO_STORE_HEADERS,
      "X-Fallback-Mode": "true",
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveNumberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveProvider(): MarketIntelProvider {
  const provider = process.env.MARKET_INTEL_PROVIDER?.trim().toLowerCase();
  if (provider === "kimi") {
    return "kimi";
  }
  if (provider === "openai") {
    return "openai";
  }
  return process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY ? "kimi" : "openai";
}

function resolveMarketIntelConfig(): MarketIntelConfig {
  const provider = resolveProvider();
  const timeoutMs = positiveNumberFromEnv(
    process.env.MARKET_INTEL_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS,
    DEFAULT_OPENAI_TIMEOUT_MS,
  );

  if (provider === "kimi") {
    const primaryModel = process.env.KIMI_MODEL ?? process.env.MOONSHOT_MODEL ?? "kimi-k2.6";

    return {
      provider,
      apiKey: process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY,
      baseURL: process.env.KIMI_BASE_URL ?? process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1",
      primaryModel,
      fallbackModel: process.env.KIMI_FALLBACK_MODEL ?? process.env.MOONSHOT_FALLBACK_MODEL ?? primaryModel,
      timeoutMs,
      maxTokens: positiveNumberFromEnv(process.env.MARKET_INTEL_MAX_TOKENS, DEFAULT_KIMI_MAX_TOKENS),
      kimiThinking: process.env.KIMI_THINKING === "enabled" ? "enabled" : "disabled",
    };
  }

  return {
    provider,
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    primaryModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    fallbackModel: process.env.OPENAI_FALLBACK_MODEL ?? "gpt-4.1-nano",
    timeoutMs,
  };
}

function isRetryableOpenAiError(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof APIConnectionTimeoutError ||
    error instanceof InternalServerError ||
    error instanceof APIConnectionError
  );
}

function fallbackReasonFromError(error: unknown): string {
  if (error instanceof RateLimitError) {
    return FALLBACK_REASONS.OPENAI_RATE_LIMIT;
  }
  if (error instanceof APIConnectionTimeoutError) {
    return FALLBACK_REASONS.OPENAI_TIMEOUT;
  }
  if (error instanceof AuthenticationError) {
    return FALLBACK_REASONS.OPENAI_AUTH;
  }
  if (error instanceof BadRequestError) {
    return FALLBACK_REASONS.OPENAI_BAD_REQUEST;
  }
  if (error instanceof InternalServerError || error instanceof APIConnectionError) {
    return FALLBACK_REASONS.OPENAI_SERVER;
  }
  if (error instanceof APIError) {
    return FALLBACK_REASONS.OPENAI_SERVER;
  }
  return FALLBACK_REASONS.UNEXPECTED;
}

function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

function latestUserQuery(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.content.trim();
    }
  }
  return messages.at(-1)?.content.trim() ?? "";
}

function buildOpenAiInput(history: ChatMessage[], telemetryMessage: string): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInput = [
    {
      role: "user",
      content: telemetryMessage,
    },
  ];

  for (const message of history) {
    input.push({
      role: message.role,
      content: message.content,
    });
  }

  return input;
}

function buildChatMessages(
  history: ChatMessage[],
  telemetryMessage: string,
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: CASCADE_INTEL_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: telemetryMessage,
    },
  ];

  for (const message of history) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  return messages;
}

function kimiThinkingForModel(model: string, config: MarketIntelConfig) {
  if (model.startsWith("kimi-k2.7-code")) {
    return undefined;
  }
  return { type: config.kimiThinking ?? "disabled" };
}

async function createResponsesStreamingResponse(
  client: OpenAI,
  model: string,
  input: OpenAI.Responses.ResponseInput,
  timeoutMs: number,
): Promise<ReadableStream<Uint8Array>> {
  const stream = await client.responses.create(
    {
      model,
      instructions: CASCADE_INTEL_SYSTEM_PROMPT,
      input,
      stream: true,
      store: false,
    },
    {
      timeout: timeoutMs,
    },
  );

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta" && event.delta) {
            controller.enqueue(encoder.encode(event.delta));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function createChatCompletionsStreamingResponse(
  client: OpenAI,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  config: MarketIntelConfig,
): Promise<ReadableStream<Uint8Array>> {
  const request: OpenAI.ChatCompletionCreateParamsStreaming & {
    thinking?: { type: "enabled" | "disabled" };
  } = {
    model,
    messages,
    stream: true,
    max_tokens: config.maxTokens,
  };

  if (config.provider === "kimi") {
    const thinking = kimiThinkingForModel(model, config);
    if (thinking) {
      request.thinking = thinking;
    }
  }

  const stream = await client.chat.completions.create(request, {
    timeout: config.timeoutMs,
  });

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            controller.enqueue(encoder.encode(delta));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function createStreamingResponse(
  client: OpenAI,
  model: string,
  payload: StreamingPayload,
  config: MarketIntelConfig,
): Promise<ReadableStream<Uint8Array>> {
  if (config.provider === "kimi") {
    return createChatCompletionsStreamingResponse(client, model, payload.chatMessages, config);
  }

  return createResponsesStreamingResponse(client, model, payload.responsesInput, config.timeoutMs);
}

async function streamWithRetries(
  client: OpenAI,
  config: MarketIntelConfig,
  payload: StreamingPayload,
): Promise<ReadableStream<Uint8Array>> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const model = attempt === 0 ? config.primaryModel : config.fallbackModel;

    try {
      return await createStreamingResponse(client, model, payload, config);
    } catch (error) {
      lastError = error;

      if (error instanceof RateLimitError && attempt === 0) {
        try {
          return await createStreamingResponse(client, config.fallbackModel, payload, config);
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }

      if (!isRetryableOpenAiError(lastError) || attempt >= RETRY_DELAYS_MS.length) {
        throw lastError;
      }

      await sleep(RETRY_DELAYS_MS[attempt] ?? 32000);
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
}

function fallbackPrefix(reason: string, telemetryAgeMs: number): string {
  if (reason === FALLBACK_REASONS.EXPORTER_TIMEOUT || reason === FALLBACK_REASONS.EXPORTER_UNREACHABLE) {
    const minutes = Math.max(1, Math.round(telemetryAgeMs / 60_000));
    return `⚠ Telemetry stale. Last reading: ${minutes}m ago.\n\n`;
  }
  if (reason === FALLBACK_REASONS.OPENAI_RATE_LIMIT) {
    return "⚠ Intel link congested. Using local rules.\n\n";
  }
  return "⚠ Intel offline. Using local rules.\n\n";
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid message format", details: parsed.error.flatten() },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { messages, telemetrySnapshot = null } = parsed.data;
  const query = latestUserQuery(messages);
  const history = trimHistory(messages);

  const exporterResult = await fetchExporterStatus({
    timeoutMs: 5000,
    snapshot: telemetrySnapshot,
  });

  const telemetryPayload = exporterResult.payload;
  const telemetryAgeMs = exporterResult.telemetryAgeMs;
  const exporterDown = exporterResult.source === "error" || telemetryPayload.health.ok === false;

  const config = resolveMarketIntelConfig();
  if (!config.apiKey) {
    const response = resolveMarketChatResponse(
      query,
      exporterDown && telemetrySnapshot ? telemetrySnapshot : telemetryPayload,
    );
    return jsonFallback({
      response: `${fallbackPrefix(FALLBACK_REASONS.OPENAI_AUTH, telemetryAgeMs)}${response}`,
      fallbackReason: FALLBACK_REASONS.OPENAI_AUTH,
      telemetryAgeMs,
    });
  }

  const context = trimStatusPayload(telemetryPayload);
  const telemetryMessage = buildTelemetryUserMessage(context);
  const payload = {
    chatMessages: buildChatMessages(history, telemetryMessage),
    responsesInput: buildOpenAiInput(history, telemetryMessage),
  };

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  try {
    const stream = await streamWithRetries(client, config, payload);

    return new Response(stream, {
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "X-Fallback-Mode": "false",
      },
    });
  } catch (error) {
    const fallbackReason = exporterDown
      ? exporterResult.source === "snapshot"
        ? FALLBACK_REASONS.EXPORTER_TIMEOUT
        : FALLBACK_REASONS.EXPORTER_UNREACHABLE
      : fallbackReasonFromError(error);

    const dataForRules =
      exporterDown && telemetrySnapshot ? telemetrySnapshot : telemetryPayload.health.ok ? telemetryPayload : telemetrySnapshot;

    const response = resolveMarketChatResponse(query, dataForRules);

    return jsonFallback({
      response: `${fallbackPrefix(fallbackReason, telemetryAgeMs)}${response}`,
      fallbackReason,
      telemetryAgeMs,
    });
  }
}
