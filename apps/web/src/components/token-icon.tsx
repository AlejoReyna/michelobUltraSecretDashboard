"use client";

import { useEffect, useMemo, useState } from "react";
import { competitionTokenLogoUrl } from "@/lib/competition-tokens";

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

function tokenIconSources(symbol: string) {
  const sources: string[] = [];
  const listedLogo = competitionTokenLogoUrl(symbol);

  if (listedLogo) {
    sources.push(listedLogo);
  }

  sources.push(`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${iconSlug(symbol)}.png`);

  return sources;
}

export function TokenIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const sources = useMemo(() => tokenIconSources(symbol), [symbol]);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [sources]);

  if (sourceIndex >= sources.length) {
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
      src={sources[sourceIndex]}
      alt=""
      width={size}
      height={size}
      className={cx("shrink-0 rounded-full bg-[#0A0A0A]")}
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
