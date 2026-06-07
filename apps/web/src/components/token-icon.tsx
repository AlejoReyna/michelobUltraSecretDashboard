"use client";

import { useState } from "react";

const SYMBOL_ALIASES: Record<string, string> = {
  WBNB: "bnb",
  WETH: "eth",
  BTCB: "btc",
};

function iconSlug(symbol: string) {
  const upper = symbol.trim().toUpperCase();
  return SYMBOL_ALIASES[upper] ?? upper.toLowerCase();
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function TokenIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const slug = iconSlug(symbol);

  if (failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] font-mono font-bold uppercase text-[#8A8A8A]"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.45) }}
        aria-hidden="true"
      >
        {symbol.trim().slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${slug}.png`}
      alt=""
      width={size}
      height={size}
      className={cx("shrink-0 rounded-full bg-[#0A0A0A]")}
      onError={() => setFailed(true)}
    />
  );
}
