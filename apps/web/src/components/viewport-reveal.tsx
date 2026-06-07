"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type RevealVariant = "up" | "down" | "left" | "right" | "fade" | "scale" | "blur" | "expand";
export type RevealDuration = "fast" | "normal" | "slow";

type ViewportRevealProps = {
  children?: ReactNode;
  className?: string;
  delay?: number;
  variant?: RevealVariant;
  duration?: RevealDuration;
  as?: "div" | "section" | "article" | "li" | "span";
  root?: Element | null;
};

export function ViewportReveal({
  children,
  className,
  delay = 0,
  variant = "up",
  duration = "normal",
  as: Tag = "div",
  root = null,
}: ViewportRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -4% 0px", root },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  return (
    <Tag
      ref={ref as never}
      className={cx(
        "viewport-reveal",
        `viewport-reveal--variant-${variant}`,
        duration !== "normal" && `viewport-reveal--duration-${duration}`,
        visible && "viewport-reveal--visible",
        className,
      )}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

const FACTOR_VARIANTS: RevealVariant[] = ["up", "left", "scale", "right", "blur", "fade"];
const OUTCOME_VARIANTS: RevealVariant[] = ["left", "right", "up", "down"];
const CHAPTER_VARIANTS: RevealVariant[] = ["fade", "left", "down", "right", "scale", "blur"];

export function factorRevealVariant(index: number): RevealVariant {
  return FACTOR_VARIANTS[index % FACTOR_VARIANTS.length] ?? "up";
}

export function outcomeRevealVariant(index: number): RevealVariant {
  return OUTCOME_VARIANTS[index % OUTCOME_VARIANTS.length] ?? "up";
}

export function chapterRevealVariant(index: number): RevealVariant {
  return CHAPTER_VARIANTS[index % CHAPTER_VARIANTS.length] ?? "fade";
}

const WALLET_STABLE_SYMBOLS = new Set(["USDC", "USDT", "BUSD", "DAI", "FDUSD"]);

export type WalletColumn = "chain" | "token" | "amount" | "value";

export function walletColumnVariant(column: WalletColumn): RevealVariant {
  switch (column) {
    case "chain":
      return "left";
    case "token":
      return "scale";
    case "amount":
      return "fade";
    case "value":
      return "up";
    default:
      return "fade";
  }
}

export function walletRowLeadVariant(
  symbol: string,
  valueUsd: number | null,
  index: number,
): RevealVariant {
  const normalized = symbol.toUpperCase();
  if (index === 0 && (valueUsd ?? 0) > 0) {
    return "scale";
  }
  if (WALLET_STABLE_SYMBOLS.has(normalized)) {
    return "fade";
  }
  if ((valueUsd ?? 0) >= 1) {
    return "up";
  }
  return index % 2 === 0 ? "right" : "left";
}

export function walletCellDelay(rowIndex: number, column: WalletColumn): number {
  const columnOffset = { chain: 0, token: 40, amount: 80, value: 120 }[column];
  return rowIndex * 55 + columnOffset;
}

export type ActivityColumn = "event" | "reference" | "status";
export type ActivityFeedMode = "logs" | "txs";

export function activityColumnVariant(column: ActivityColumn): RevealVariant {
  switch (column) {
    case "event":
      return "scale";
    case "reference":
      return "left";
    case "status":
      return "fade";
    default:
      return "fade";
  }
}

export function activityReferenceVariant(mode: ActivityFeedMode): RevealVariant {
  return mode === "txs" ? "right" : "left";
}

export function activityStatusVariant(tone: "green" | "yellow" | "red"): RevealVariant {
  switch (tone) {
    case "green":
      return "up";
    case "yellow":
      return "fade";
    case "red":
      return "down";
    default:
      return "fade";
  }
}

export function activityCellDelay(rowIndex: number, column: ActivityColumn): number {
  const columnOffset = { event: 0, reference: 45, status: 90 }[column];
  return rowIndex * 50 + columnOffset;
}

export function activityLeadEventVariant(index: number, mode: ActivityFeedMode): RevealVariant {
  if (index === 0) {
    return mode === "txs" ? "blur" : "scale";
  }
  return activityColumnVariant("event");
}

export type PositionColumn =
  | "token"
  | "amount"
  | "entry"
  | "value"
  | "high"
  | "stop"
  | "target"
  | "opened";

export function positionColumnVariant(column: PositionColumn): RevealVariant {
  switch (column) {
    case "token":
      return "scale";
    case "amount":
      return "fade";
    case "entry":
      return "left";
    case "value":
      return "up";
    case "high":
      return "up";
    case "stop":
      return "down";
    case "target":
      return "right";
    case "opened":
      return "fade";
    default:
      return "fade";
  }
}

export function positionCellDelay(rowIndex: number, column: PositionColumn): number {
  const columnOffset = {
    token: 0,
    amount: 35,
    entry: 70,
    value: 105,
    high: 140,
    stop: 175,
    target: 210,
    opened: 245,
  }[column];
  return rowIndex * 60 + columnOffset;
}

export function positionLeadVariant(index: number): RevealVariant {
  return index === 0 ? "blur" : positionColumnVariant("token");
}

export function homeMetricVariant(
  label: string,
  tone?: "positive" | "negative",
): RevealVariant {
  if (label.includes("Balance")) {
    return "scale";
  }
  if (label.includes("Profit") || label.includes("Loss")) {
    return tone === "negative" ? "down" : "up";
  }
  if (label.includes("Trades")) {
    return "fade";
  }
  if (label.includes("Rate")) {
    return "blur";
  }
  return "fade";
}

export function homeMetricDelay(index: number): number {
  return 80 + index * 70;
}
