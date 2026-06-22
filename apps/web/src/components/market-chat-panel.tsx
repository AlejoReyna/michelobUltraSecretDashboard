"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TypewriterText } from "@/components/typewriter-text";
import {
  createAssistantMessage,
  createUserMessage,
  pickIntelGreeting,
  readStoredChatMessages,
  writeStoredChatMessages,
  type ChatMessage,
} from "@/lib/market-chat-engine";
import type { StatusPayload } from "@/lib/schemas";

type FadePhase = "visible" | "out" | "hidden";

const FADE_OUT_MS = 300;

function formatAssistantContent(content: string) {
  return content.startsWith(">") ? content : `> ${content}`;
}

function useNow(tickMs = 30_000) {
  return useSyncExternalStore(
    (onStoreChange) => {
      const interval = window.setInterval(onStoreChange, tickMs);
      return () => window.clearInterval(interval);
    },
    () => Date.now(),
    () => Date.now(),
  );
}

function useFadePhase(initialPhase: FadePhase = "visible") {
  const [phase, setPhase] = useState<FadePhase>(initialPhase);

  function dismiss() {
    setPhase((current) => (current === "visible" ? "out" : current));
  }

  useEffect(() => {
    if (phase !== "out") return;
    const timeout = window.setTimeout(() => setPhase("hidden"), FADE_OUT_MS);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  return { phase, dismiss };
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function IntelSectionHeader({
  compact = false,
  desktop = false,
  greetingPhase,
}: {
  compact?: boolean;
  desktop?: boolean;
  greetingPhase: FadePhase;
}) {
  const now = useNow();
  const [greeting] = useState(() => pickIntelGreeting());

  return (
    <div>
      {/* terminal title bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-bold text-[#b07de3]/60">{"//"}</span>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7f7f94]">
            MARKET_INTEL
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#33c28e] shadow-[0_0_4px_#33c28e]" />
        </div>
        <span className="font-mono text-[9px] tabular-nums text-[#3f3f50]">
          {formatTimestamp(new Date(now).toISOString())} UTC
        </span>
      </div>

      {/* welcome message */}
      {greetingPhase !== "hidden" ? (
        <div className={cx("mt-3", greetingPhase === "out" && "section-fade-out")}>
          <div className="section-fade-in font-mono text-[10px] text-[#3f3f50]">
            {"┌─────────────────────────────────────┐"}
          </div>
          <div
            className={cx(
              "section-fade-in font-mono font-semibold leading-snug text-[#b07de3]",
              compact || desktop ? "text-[13px]" : "text-[14px]",
            )}
          >
            {"│ "}{greeting}
          </div>
          <div className="section-fade-in font-mono text-[10px] text-[#3f3f50]">
            {"└─────────────────────────────────────┘"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({
  message,
  animate = false,
  streaming = false,
  compact = false,
}: {
  message: ChatMessage;
  animate?: boolean;
  streaming?: boolean;
  compact?: boolean;
}) {
  const isUser = message.role === "user";
  const content = isUser ? message.content : formatAssistantContent(message.content);
  const ts = formatTimestamp(message.timestamp);

  return (
    <div className="flex flex-col gap-0.5">
      {/* prompt line */}
      <div className="flex items-baseline gap-1.5">
        <span className={cx(
          "shrink-0 font-mono tabular-nums",
          compact ? "text-[9px]" : "text-[10px]",
          "text-[#3f3f50]",
        )}>
          [{ts}]
        </span>
        <span className={cx(
          "shrink-0 font-mono font-bold",
          compact ? "text-[9px]" : "text-[10px]",
          isUser ? "text-[#b07de3]" : "text-[#33c28e]",
        )}>
          {isUser ? "cascade:~$" : "intel:>"}
        </span>
        {isUser ? (
          <span className={cx(
            "font-mono leading-snug text-white break-words min-w-0",
            compact ? "text-[11px]" : "text-[12px]",
          )}>
            {content}
          </span>
        ) : null}
      </div>

      {/* assistant output block */}
      {!isUser ? (
        <div className={cx(
          "ml-[3.25rem] border-l-2 border-[#1e1e2e] pl-3",
          message.fallback && "border-[#8A6A3A]/40",
        )}>
          {message.fallback ? (
            <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#8A6A3A]">
              // offline_mode
            </div>
          ) : null}
          <div className={cx(
            "font-mono leading-[1.6] whitespace-pre-wrap break-words text-[#c0c0d0]",
            compact ? "text-[11px]" : "text-[12px]",
          )}>
            {animate ? (
              <TypewriterText text={content} speed={14} startDelay={120} />
            ) : (
              <>
                {content}
                {streaming ? <span className="typewriter-cursor" aria-hidden="true" /> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  compact = false,
  desktop = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
  desktop?: boolean;
}) {
  const canSend = value.trim().length > 0 && !disabled;

  return (
    <form
      className={cx(
        "flex w-full shrink-0 items-center gap-2 border-t border-[#1e1e2e] bg-[#0B0E11]",
        compact ? "px-4 py-2.5" : desktop ? "px-8 py-4" : "px-4 py-3",
        disabled && "opacity-40",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <span className={cx(
        "shrink-0 font-mono font-bold text-[#b07de3]",
        compact ? "text-[10px]" : "text-[11px]",
      )}>
        cascade:~$
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        rows={1}
        placeholder="query market intel..."
        disabled={disabled}
        className={cx(
          "max-h-28 min-h-0 flex-1 resize-none bg-transparent py-0 font-mono text-white outline-none placeholder:text-[#2e2e3e] caret-[#b07de3]",
          compact ? "text-[11px] leading-[18px]" : desktop ? "text-[13px] leading-[28px]" : "text-[12px] leading-[22px]",
        )}
        aria-label="Market chat message"
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={cx(
          "shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] border px-2 py-1 transition-colors",
          canSend
            ? "border-[#b07de3]/50 text-[#b07de3] hover:border-[#b07de3] hover:bg-[#b07de3]/10"
            : "border-[#2e2e3e] text-[#2e2e3e]",
        )}
      >
        [exec]
      </button>
    </form>
  );
}

function MarketChatSurface({
  data,
  compact = false,
  desktop = false,
  onChatStart,
}: {
  data: StatusPayload | null;
  compact?: boolean;
  desktop?: boolean;
  onChatStart?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readStoredChatMessages());
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);

  useEffect(() => { dataRef.current = data; }, [data]);

  const interactionDisabled = thinking;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, thinking]);

  async function sendMessage(raw: string) {
    const content = raw.trim();
    if (!content || interactionDisabled) return;

    const userMessage = createUserMessage(content);
    const historyForApi = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((current) => {
      if (current.length === 0) onChatStart?.();
      const next = [...current, userMessage];
      writeStoredChatMessages(next);
      return next;
    });
    setDraft("");
    setThinking(true);
    setRequestError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForApi, telemetrySnapshot: dataRef.current }),
      });

      if (!response.ok && response.status === 400) {
        setRequestError("ERR: invalid message format");
        setThinking(false);
        return;
      }

      const fallbackMode = response.headers.get("X-Fallback-Mode") === "true";
      const contentType = response.headers.get("Content-Type") ?? "";

      if (fallbackMode || contentType.includes("application/json")) {
        const payload = (await response.json()) as { response?: string };
        const assistantMessage = {
          ...createAssistantMessage(payload.response ?? "No response available."),
          fallback: true,
        };
        const stored = readStoredChatMessages();
        const next = [...stored, assistantMessage];
        writeStoredChatMessages(next);
        setMessages(next);
        setStreamingId(assistantMessage.id);
        setThinking(false);
        return;
      }

      const assistantMessage = createAssistantMessage("");
      const placeholder = [...readStoredChatMessages(), assistantMessage];
      writeStoredChatMessages(placeholder);
      setMessages(placeholder);
      setStreamingId(assistantMessage.id);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response stream");

      const decoder = new TextDecoder();
      let streamed = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id ? { ...message, content: streamed } : message,
          ),
        );
      }

      const finalMessage = { ...assistantMessage, content: streamed };
      const stored = readStoredChatMessages().filter((message) => message.id !== assistantMessage.id);
      const next = [...stored, finalMessage];
      writeStoredChatMessages(next);
      setMessages(next);
      setStreamingId(null);
      setThinking(false);
    } catch {
      const assistantMessage = {
        ...createAssistantMessage("ERR: intel offline. using local rules.\n\nrequest failed — try again."),
        fallback: true,
      };
      const stored = readStoredChatMessages();
      const next = [...stored, assistantMessage];
      writeStoredChatMessages(next);
      setMessages(next);
      setStreamingId(assistantMessage.id);
      setThinking(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className={cx(
          "console-scroll min-h-0 flex-1 overflow-y-auto",
          compact ? "px-4" : desktop ? "px-8" : "px-4",
        )}
      >
        <div className="flex flex-col gap-4 py-4">
          {messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              animate={message.id === streamingId && message.role === "assistant" && message.fallback === true}
              streaming={message.id === streamingId && message.role === "assistant" && !message.fallback && thinking}
              compact={compact}
            />
          ))}
          {requestError ? (
            <div className="font-mono text-[11px] text-[#e05b73]">{requestError}</div>
          ) : null}
          {thinking && !streamingId ? (
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] text-[#3f3f50]">[{formatTimestamp(new Date().toISOString())}]</span>
              <span className="font-mono text-[10px] font-bold text-[#33c28e]">intel:{">"}</span>
              <span className="font-mono text-[11px] text-[#5f5f70]">
                reading x402 telemetry<span className="typewriter-cursor" aria-hidden="true" />
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => sendMessage(draft)}
        disabled={interactionDisabled}
        compact={compact}
        desktop={desktop}
      />
    </div>
  );
}

export function MarketChatPanel({
  data,
  compact = false,
  desktop = false,
}: {
  data: StatusPayload | null;
  compact?: boolean;
  desktop?: boolean;
}) {
  const chatAlreadyStarted = readStoredChatMessages().length > 0;
  const { phase: greetingPhase, dismiss: dismissGreeting } = useFadePhase(
    chatAlreadyStarted ? "hidden" : "visible",
  );

  return (
    <section
      className={cx(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden",
        compact && "pt-4",
        desktop && "pt-6",
      )}
    >
      <div
        className={cx(
          "shrink-0 border-b border-[#1e1e2e]",
          compact ? "px-4" : desktop ? "px-8" : "px-4",
          greetingPhase === "hidden" ? "pb-2" : "pb-3",
        )}
      >
        <IntelSectionHeader compact={compact} desktop={desktop} greetingPhase={greetingPhase} />
      </div>
      <MarketChatSurface
        data={data}
        compact={compact}
        desktop={desktop}
        onChatStart={dismissGreeting}
      />
    </section>
  );
}
