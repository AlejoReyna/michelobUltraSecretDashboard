"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp } from "lucide-react";
import { TypewriterText } from "@/components/typewriter-text";
import {
  createAssistantMessage,
  createUserMessage,
  resolveMarketChatResponse,
  SUGGESTED_PROMPTS,
  type ChatMessage,
} from "@/lib/market-chat-engine";
import type { StatusPayload } from "@/lib/schemas";

const DISCLAIMER_STORAGE_KEY = "cascade-market-intel-disclaimer-accepted";
const MOBILE_NAV_HEIGHT = 52;
const MOBILE_CHAT_FOOTER_HEIGHT = 72;

const DISCLAIMER_TEXT =
  "The information presented here isn't intended to be used as market picks or signals, use the presented data with caution. Gambling destroys.";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMessageTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
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

function ChatSessionHeader() {
  const now = useNow();

  return (
    <div className="px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#5A5A5A]">
      Market Intel · {formatMessageTime(new Date(now).toISOString())}
    </div>
  );
}

function DisclaimerGate({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/92 px-6 backdrop-blur-[2px]">
      <div className="max-w-md text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A]">Before you continue</p>
        <button
          type="button"
          onClick={onAccept}
          className="mt-5 w-full rounded-sm border border-[#3A3A3A] bg-[#111111] px-4 py-4 font-mono text-[11px] leading-[1.6] text-[#D0D0D0] transition-colors hover:border-[#555555] hover:bg-[#181818] hover:text-white"
        >
          {DISCLAIMER_TEXT}
        </button>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  animate = false,
  compact = false,
}: {
  message: ChatMessage;
  animate?: boolean;
  compact?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cx("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[min(100%,42rem)]", isUser ? "text-right" : "text-left")}>
        <div
          className={cx(
            "inline-block text-left font-mono leading-[1.55] whitespace-pre-wrap break-words",
            compact ? "text-[12px]" : "text-[13px]",
            isUser
              ? "rounded-sm border border-[#333333] bg-[#141414] px-3 py-2.5 text-white"
              : "px-1 py-1 text-[#D8D8D8]",
          )}
        >
          {animate && !isUser ? (
            <TypewriterText text={message.content} speed={14} startDelay={120} />
          ) : (
            message.content
          )}
        </div>
        <div
          className={cx(
            "mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#5A5A5A]",
            isUser ? "text-right" : "text-left",
          )}
        >
          {isUser ? "You" : "Market Intel"} · {formatMessageTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const canSend = value.trim().length > 0 && !disabled;

  return (
    <form
      className={cx(
        "flex w-full shrink-0 items-center gap-2 border-t border-[#1A1A1A] bg-black/90 px-4 py-2.5",
        !compact && "sticky bottom-0 z-10",
        disabled && "opacity-50",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) {
          onSubmit();
        }
      }}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSend) {
              onSubmit();
            }
          }
        }}
        rows={1}
        placeholder="Ask about scans, x402 payments, or factor scores…"
        disabled={disabled}
        className={cx(
          "max-h-28 min-h-0 flex-1 resize-none bg-transparent py-0 font-mono text-white outline-none placeholder:text-[#5A5A5A]",
          compact ? "text-[12px] leading-5" : "text-[13px] leading-6",
        )}
        aria-label="Market chat message"
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={cx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors",
          canSend
            ? "border-[#444444] bg-white text-black hover:bg-[#E8E8E8]"
            : "border-[#222222] bg-[#111111] text-[#444444]",
        )}
      >
        <ArrowUp size={16} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </form>
  );
}

function SuggestedPromptBar({
  onSelect,
  disabled,
  compact = false,
}: {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex shrink-0 flex-wrap",
        compact ? "gap-1 px-3 pb-1 pt-0" : "gap-1.5 px-4 pb-2 pt-1",
      )}
    >
      {SUGGESTED_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className={cx(
            "rounded-sm border border-[#242424] bg-[#0A0A0A] font-mono text-[#8A8A8A] transition-colors hover:border-[#3A3A3A] hover:text-[#C8C8C8] disabled:opacity-40",
            compact
              ? "px-1.5 py-px text-[8px] leading-3"
              : "px-2 py-0.5 text-[9px] leading-4",
          )}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

function MarketChatSurface({
  data,
  compact = false,
  blocked = false,
}: {
  data: StatusPayload | null;
  compact?: boolean;
  blocked?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const interactionDisabled = blocked || thinking;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages, thinking]);

  function sendMessage(raw: string) {
    const content = raw.trim();
    if (!content || interactionDisabled) {
      return;
    }

    const userMessage = createUserMessage(content);
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setThinking(true);

    window.setTimeout(() => {
      const response = resolveMarketChatResponse(content, dataRef.current);
      const assistantMessage = createAssistantMessage(response);
      setMessages((current) => [...current, assistantMessage]);
      setStreamingId(assistantMessage.id);
      setThinking(false);
    }, 420);
  }

  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col",
        blocked && "pointer-events-none select-none opacity-40",
      )}
      aria-hidden={blocked}
    >
      <div
        ref={scrollRef}
        className="console-scroll min-h-0 flex-1 overflow-y-auto px-4"
        style={compact ? { paddingBottom: MOBILE_CHAT_FOOTER_HEIGHT } : undefined}
      >
        <div className="flex flex-col gap-5 py-4">
          <ChatSessionHeader />
          {messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              animate={message.id === streamingId && message.role === "assistant"}
              compact={compact}
            />
          ))}
          {thinking ? (
            <div className="px-1 font-mono text-[12px] text-[#8A8A8A]">
              Reading x402 telemetry
              <span className="typewriter-cursor" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </div>

      {compact ? (
        <div
          className="fixed inset-x-0 z-30 mx-auto max-w-[640px]"
          style={{ bottom: `calc(${MOBILE_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }}
        >
          <SuggestedPromptBar onSelect={sendMessage} disabled={interactionDisabled} compact />
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => sendMessage(draft)}
            disabled={interactionDisabled}
            compact
          />
        </div>
      ) : (
        <>
          <SuggestedPromptBar onSelect={sendMessage} disabled={interactionDisabled} compact={compact} />
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => sendMessage(draft)}
            disabled={interactionDisabled}
            compact={compact}
          />
        </>
      )}
    </div>
  );
}

function useDisclaimerAccepted() {
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setAccepted(window.sessionStorage.getItem(DISCLAIMER_STORAGE_KEY) === "1");
    } catch {
      setAccepted(false);
    }
    setReady(true);
  }, []);

  function accept() {
    try {
      window.sessionStorage.setItem(DISCLAIMER_STORAGE_KEY, "1");
    } catch {
      // Ignore storage failures — still unlock for this session.
    }
    setAccepted(true);
  }

  return { accepted, ready, accept };
}

export function MarketChatPanel({
  data,
  compact = false,
}: {
  data: StatusPayload | null;
  compact?: boolean;
  desktop?: boolean;
}) {
  const { accepted, ready, accept } = useDisclaimerAccepted();

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {ready && !accepted ? <DisclaimerGate onAccept={accept} /> : null}
      <MarketChatSurface data={data} compact={compact} blocked={!accepted} />
    </section>
  );
}
