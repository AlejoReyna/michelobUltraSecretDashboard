import { detailsFromDecision } from "@/lib/log-event-details";
import type { StatusPayload } from "@/lib/schemas";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export const CHAT_MESSAGES_STORAGE_KEY = "cascade-market-intel-chat-messages";

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as ChatMessage;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.timestamp === "string"
  );
}

export function readStoredChatMessages(): ChatMessage[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isChatMessage);
  } catch {
    return [];
  }
}

export function writeStoredChatMessages(messages: ChatMessage[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Ignore storage failures.
  }
}

export const SUGGESTED_PROMPTS = [
  "What's the latest market scan?",
  "How does x402 pay for CMC data?",
  "Show factor scores for the current target",
  "When was market data last refreshed?",
  "Recent x402 micropayments",
] as const;

export const INTEL_GREETING_PHRASES = [
  "Hey, good to see you",
  "Welcome back",
  "Hi there, operator",
  "Hey — what's up",
  "Good to have you",
  "Hey, welcome in",
  "Glad you're here",
  "Hey, pull up a seat",
  "Welcome, operator",
  "Hey, how's it going",
] as const;

export function pickIntelGreeting(): string {
  const index = Math.floor(Math.random() * INTEL_GREETING_PHRASES.length);
  return INTEL_GREETING_PHRASES[index] ?? INTEL_GREETING_PHRASES[0];
}

type FileStatus = {
  exists?: boolean;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return "unknown";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.round(deltaMs / 60_000);

  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCacheLine(label: string, file: FileStatus | undefined): string {
  if (!file?.exists) {
    return `• ${label}: not on disk`;
  }

  const age = formatRelativeTime(file.modifiedAt);
  const size =
    typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes)
      ? ` · ${(file.sizeBytes / 1024).toFixed(1)} KB`
      : "";

  return `• ${label}: updated ${age}${size}`;
}

function x402Movements(data: StatusPayload) {
  return data.wallet.movements.filter(
    (movement) =>
      movement.action?.toLowerCase().includes("x402") ||
      movement.provider?.toLowerCase().includes("x402"),
  );
}

function latestScanSummary(data: StatusPayload): string {
  const decision = data.latestDecision;
  if (!decision) {
    return "No decision telemetry yet. The agent hasn't completed a scan cycle since telemetry connected.";
  }

  const analysis = detailsFromDecision(decision);
  const factors =
    analysis.factors?.map((factor) => `${factor.passed ? "✓" : "✗"} ${factor.label}`).join("\n") ??
    "Factor scores not available for this cycle.";

  return [
    `Cycle #${decision.cycle_number ?? "N/A"} · action ${decision.action}`,
    decision.symbol ? `Target: ${decision.symbol}` : null,
    decision.priced_target_count != null
      ? `${decision.priced_target_count} competition tokens priced this cycle`
      : null,
    decision.true_factor_count != null ? `Score: ${decision.true_factor_count}/6 factors` : null,
    decision.estimated_slippage_pct != null
      ? `Est. slippage: ${(decision.estimated_slippage_pct * 100).toFixed(2)}%`
      : null,
    decision.reason ? `Reason: ${decision.reason}` : null,
    "",
    "Factor checklist:",
    factors,
  ]
    .filter(Boolean)
    .join("\n");
}

function x402Overview(data: StatusPayload): string {
  const x402 = data.x402;
  const payments = x402Movements(data);

  const lines = [
    "x402 is the HTTP micropayment rail the bot uses on Base to pay for CoinMarketCap market data via TWAK.",
    "",
    `Instrumentation: ${x402.instrumented ? "active" : "placeholder (exporter not yet streaming records)"}`,
    x402.paidCallCount != null ? `Paid CMC calls (session): ${x402.paidCallCount}` : null,
    payments.length > 0
      ? `Wallet history shows ${payments.length} x402 settlement${payments.length === 1 ? "" : "s"}`
      : "No x402 settlements in wallet history yet",
    "",
    "This dashboard is read-only — it observes x402 usage from telemetry but never triggers paid CMC calls.",
  ];

  return lines.filter(Boolean).join("\n");
}

function cacheFreshness(data: StatusPayload): string {
  const priceCache = data.files.priceCache as FileStatus | undefined;
  const volumeCache = data.files.volumeCache as FileStatus | undefined;

  return [
    "Market caches are written by the bot after each x402-backed CMC pull:",
    "",
    formatCacheLine("price_cache.json", priceCache),
    formatCacheLine("volume_cache.json", volumeCache),
    "",
    data.latestDecision?.priced_target_count != null
      ? `Latest scan priced ${data.latestDecision.priced_target_count} allowlist targets.`
      : "Target pricing count will appear after the next scan cycle.",
    "",
    "Cache contents are not exported to the dashboard yet — only freshness metadata is available.",
  ].join("\n");
}

function recentPayments(data: StatusPayload): string {
  const payments = x402Movements(data);

  if (payments.length === 0) {
    return "No x402 micropayments found in wallet movement history. When the bot pays for CMC access on Base, settlements appear here.";
  }

  const lines = payments.slice(0, 5).map((payment) => {
    const amount =
      payment.amountIn != null ? `${payment.amountIn} ${payment.fromSymbol ?? "USDC"}` : "amount N/A";
    const when = formatRelativeTime(payment.timestamp);
    const chain = payment.chain?.toUpperCase() ?? "BASE";

    return `• ${when} · ${chain} · ${amount} → ${payment.output ?? "market data"} (${payment.provider ?? "x402"})`;
  });

  return ["Recent x402 settlements:", "", ...lines].join("\n");
}

function regimeSummary(data: StatusPayload): string {
  const decision = data.latestDecision;
  if (!decision) {
    return "Regime signal unavailable — waiting for the first decision row.";
  }

  const regimePassed = decision.factor_scores?.regime_not_risk_off;
  const derivativesPassed = decision.factor_scores?.derivatives_risk_clear;

  return [
    `Latest regime read (${decision.symbol ?? "no symbol"}):`,
    "",
    regimePassed === true
      ? "✓ Macro regime is not risk-off — new entries are allowed from a sentiment standpoint."
      : regimePassed === false
        ? "✗ Risk-off regime detected — this is a common reason entries get blocked."
        : "• Regime factor not scored this cycle.",
    derivativesPassed === true
      ? "✓ Derivatives markets show no elevated systemic risk."
      : derivativesPassed === false
        ? "✗ Derivatives risk flag is elevated for this token."
        : "• Derivatives factor not scored this cycle.",
    "",
    decision.entries_allowed === false
      ? "Guardrails currently block new entries regardless of factor scores."
      : "Entry guardrails are open — factor scores still gate individual trades.",
  ].join("\n");
}

function matches(input: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(input));
}

export function resolveMarketChatResponse(query: string, data: StatusPayload | null): string {
  if (!data) {
    return "Telemetry is disconnected. I can only answer market questions once /api/status returns live data.";
  }

  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return "Ask me about the latest scan, x402 payments, factor scores, or cache freshness.";
  }

  if (matches(normalized, [/x402|micropay|cmc pay|twak/])) {
    if (matches(normalized, [/recent|history|payment|spend|cost/])) {
      return recentPayments(data);
    }
    return x402Overview(data);
  }

  if (matches(normalized, [/cache|refresh|fresh|price_cache|volume_cache|updated/])) {
    return cacheFreshness(data);
  }

  if (matches(normalized, [/factor|score|signal|checklist|variable/])) {
    return latestScanSummary(data);
  }

  if (matches(normalized, [/regime|risk.?off|macro|sentiment/])) {
    return regimeSummary(data);
  }

  if (matches(normalized, [/scan|cycle|latest|target|market|priced/])) {
    return latestScanSummary(data);
  }

  if (matches(normalized, [/payment|settlement|spend/])) {
    return recentPayments(data);
  }

  return [
    "I interpret market telemetry from the bot's x402-backed CMC pipeline. Try asking about:",
    "",
    "• Latest scan — cycle, target symbol, priced token count",
    "• Factor scores — six-entry checklist for the current target",
    "• x402 — how micropayments fund CMC data on Base",
    "• Cache freshness — when price/volume caches were last written",
    "• Regime — risk-off and derivatives risk flags",
    "",
    latestScanSummary(data),
  ].join("\n");
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: `user-${Date.now()}`,
    role: "user",
    content: content.trim(),
    timestamp: new Date().toISOString(),
  };
}

export function createAssistantMessage(content: string): ChatMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
  };
}
