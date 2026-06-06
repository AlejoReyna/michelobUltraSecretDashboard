import type { StatusPayload } from "@/lib/schemas";

// BNB Hack Track 1 eligible BEP-20 tokens (149-token allowlist).
// Source: https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail
export const COMPETITION_TOKENS = [
  "ETH",
  "USDT",
  "USDC",
  "XRP",
  "TRX",
  "DOGE",
  "ZEC",
  "ADA",
  "LINK",
  "BCH",
  "DAI",
  "TON",
  "USD1",
  "USDe",
  "M",
  "LTC",
  "AVAX",
  "SHIB",
  "XAUt",
  "WLFI",
  "H",
  "DOT",
  "UNI",
  "ASTER",
  "DEXE",
  "USDD",
  "ETC",
  "AAVE",
  "ATOM",
  "U",
  "STABLE",
  "FIL",
  "INJ",
  "币安人生",
  "NIGHT",
  "FET",
  "TUSD",
  "BONK",
  "PENGU",
  "CAKE",
  "SIREN",
  "LUNC",
  "ZRO",
  "KITE",
  "FDUSD",
  "BEAT",
  "PIEVERSE",
  "BTT",
  "NFT",
  "EDGE",
  "FLOKI",
  "LDO",
  "B",
  "FF",
  "PENDLE",
  "NEX",
  "STG",
  "AXS",
  "TWT",
  "HOME",
  "RAY",
  "COMP",
  "GWEI",
  "XCN",
  "GENIUS",
  "XPL",
  "BAT",
  "SKYAI",
  "APE",
  "IP",
  "SFP",
  "TAG",
  "NXPC",
  "AB",
  "SAHARA",
  "1INCH",
  "CHEEMS",
  "BANANAS31",
  "RIVER",
  "MYX",
  "RAVE",
  "SNX",
  "FORM",
  "LAB",
  "HTX",
  "USDf",
  "CTM",
  "BDX",
  "SLX",
  "UB",
  "DUCKY",
  "FRAX",
  "BILL",
  "WFI",
  "KOGE",
  "ALE",
  "FRXUSD",
  "USDF",
  "GOMINING",
  "VCNT",
  "GUA",
  "DUSD",
  "SMILEK",
  "0G",
  "BEAM",
  "MY",
  "SOON",
  "REAL",
  "Q",
  "AIOZ",
  "ZIG",
  "YFI",
  "TAC",
  "lisUSD",
  "CYS",
  "ZAMA",
  "TRIA",
  "HUMA",
  "PLUME",
  "ZIL",
  "XPR",
  "ZETA",
  "BabyDoge",
  "NILA",
  "ROSE",
  "VELO",
  "UAI",
  "BRETT",
  "OPEN",
  "BSB",
  "TOSHI",
  "BAS",
  "ACH",
  "AXL",
  "LUR",
  "ELF",
  "KAVA",
  "APR",
  "IRYS",
  "EURI",
  "XUSD",
  "BARD",
  "DUSK",
  "SUSHI",
  "PEAQ",
  "COAI",
  "BDCA",
  "XAUM",
] as const;

const COMPETITION_TOKEN_KEYS = new Set(COMPETITION_TOKENS.map(competitionTokenKey));

const QUOTE_ASSETS = new Set(
  [
    "USDT",
    "USDC",
    "DAI",
    "TUSD",
    "FDUSD",
    "USDD",
    "USD1",
    "USDE",
    "USDf",
    "USDF",
    "FRXUSD",
    "DUSD",
    "EURI",
    "XUSD",
    "XAUt",
    "LISUSD",
    "FRAX",
  ].map(competitionTokenKey),
);

export type WalletHolding = {
  symbol: string;
  amount: number | null;
  valueUsd: number | null;
  entryValueUsd: number | null;
  chain: string;
};

export function competitionTokenKey(symbol: string) {
  const trimmed = symbol.trim();
  if (/^[\x00-\x7F]+$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

export function isCompetitionToken(symbol: string) {
  return COMPETITION_TOKEN_KEYS.has(competitionTokenKey(symbol));
}

export function isQuoteAsset(symbol: string) {
  return QUOTE_ASSETS.has(competitionTokenKey(symbol));
}

function upsertHolding(map: Map<string, WalletHolding>, holding: WalletHolding) {
  const key = competitionTokenKey(holding.symbol);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, holding);
    return;
  }

  map.set(key, {
    symbol: existing.symbol || holding.symbol,
    amount: existing.amount ?? holding.amount,
    valueUsd: holding.valueUsd ?? existing.valueUsd,
    entryValueUsd: existing.entryValueUsd ?? holding.entryValueUsd,
    chain: existing.chain || holding.chain,
  });
}

export function boughtTokensFromTelemetry(data: StatusPayload | null): WalletHolding[] {
  const holdings = new Map<string, WalletHolding>();

  for (const position of data?.positions.positions ?? []) {
    if (!isCompetitionToken(position.symbol) || isQuoteAsset(position.symbol)) {
      continue;
    }

    const amount = position.amount_tokens;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    upsertHolding(holdings, {
      symbol: position.symbol,
      amount,
      valueUsd: null,
      entryValueUsd: position.entry_value_usdc ?? null,
      chain: "bsc",
    });
  }

  for (const balance of data?.wallet.balances ?? []) {
    if (balance.chain !== "bsc") {
      continue;
    }

    if (!isCompetitionToken(balance.symbol) || isQuoteAsset(balance.symbol)) {
      continue;
    }

    const amount = balance.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    upsertHolding(holdings, {
      symbol: balance.symbol,
      amount,
      valueUsd: balance.valueUsd ?? null,
      entryValueUsd: null,
      chain: balance.chain,
    });
  }

  return Array.from(holdings.values()).sort((left, right) => {
    const leftValue = left.valueUsd ?? left.entryValueUsd ?? 0;
    const rightValue = right.valueUsd ?? right.entryValueUsd ?? 0;
    return rightValue - leftValue;
  });
}
