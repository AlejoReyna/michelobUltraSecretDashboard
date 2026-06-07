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

export type WalletBalanceRow = {
  chain: string;
  symbol: string;
  amount: number | null;
  valueUsd: number | null;
};

export type WalletHolding = {
  symbol: string;
  amount: number | null;
  valueUsd: number | null;
  entryValueUsd: number | null;
  paperTargetUsd: number | null;
  mode: string | null;
  chain: string;
  status: "HELD" | "TRACKED" | "CLOSED";
};

function isPaperMode(mode: string | null | undefined) {
  return String(mode ?? "").toLowerCase() === "paper";
}

function entryFromDecision(decision: StatusPayload["decisions"][number]) {
  if (isPaperMode(decision.mode)) {
    return {
      entryValueUsd: null,
      paperTargetUsd: decision.position_size_usdc ?? null,
      mode: decision.mode ?? "paper",
    };
  }

  return {
    entryValueUsd: decision.position_size_usdc ?? null,
    paperTargetUsd: null,
    mode: decision.mode ?? null,
  };
}

const CLOSE_DECISION_ACTIONS = new Set(["EXIT", "CLOSE", "SELL"]);

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.replaceAll(",", "").match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
    if (match) {
      const parsed = Number.parseFloat(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
}

function parseOutputAmount(output: string | null | undefined): number | null {
  if (!output) {
    return null;
  }

  return parseNumeric(output.split(/\s+/)[0]);
}

function executionSucceeded(execution: StatusPayload["executions"][number]) {
  const status = String(execution.result?.status ?? execution.result?.mode ?? "").toLowerCase();
  const txHash =
    execution.tx_hash ??
    (typeof execution.result?.tx_hash === "string" ? execution.result.tx_hash : null) ??
    (typeof execution.result?.hash === "string" ? execution.result.hash : null);

  return Boolean(txHash || status.includes("success") || status === "twak" || status === "completed");
}

export function liveWalletBalancesFromTelemetry(data: StatusPayload | null): WalletBalanceRow[] {
  const rows = new Map<string, WalletBalanceRow>();

  const upsert = (chain: string, symbol: string, amount: number | null, valueUsd: number | null) => {
    if (!symbol || symbol.toUpperCase() === "TOTALUSD") {
      return;
    }

    const amountOk = typeof amount === "number" && Number.isFinite(amount) && amount > 0;
    const valueOk = typeof valueUsd === "number" && Number.isFinite(valueUsd) && valueUsd > 0;
    if (!amountOk && !valueOk) {
      return;
    }

    const key = `${chain.toLowerCase()}:${competitionTokenKey(symbol)}`;
    const existing = rows.get(key);
    rows.set(key, {
      chain,
      symbol,
      amount: amount ?? existing?.amount ?? null,
      valueUsd: valueUsd ?? existing?.valueUsd ?? null,
    });
  };

  for (const balance of data?.wallet.balances ?? []) {
    upsert(balance.chain, balance.symbol, balance.amount ?? null, balance.valueUsd ?? null);
  }

  for (const balance of portfolioBalancesFromStatus(data)) {
    upsert(balance.chain, balance.symbol, balance.amount, balance.valueUsd);
  }

  return Array.from(rows.values()).sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0));
}

export function agentModeLabel(data: StatusPayload | null) {
  const mode = data?.latestDecision?.mode;
  return mode ? String(mode).toUpperCase() : "UNKNOWN";
}

function portfolioBalancesFromStatus(data: StatusPayload | null) {
  const portfolio = data?.balances?.portfolio;
  if (!portfolio?.ok || !Array.isArray(portfolio.data)) {
    return [];
  }

  return portfolio.data.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const row = item as Record<string, unknown>;
    const chain = typeof row.chain === "string" ? row.chain : "bsc";
    const symbol = typeof row.symbol === "string" ? row.symbol : null;
    const amount = parseNumeric(row.balance ?? row.amount);
    const valueUsd = parseNumeric(row.usdValue ?? row.valueUsd ?? row.value_usd);

    if (!symbol || (amount === null && valueUsd === null)) {
      return [];
    }

    return [{ chain, symbol, amount, valueUsd }];
  });
}

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

function openPositionsFromDecisions(data: StatusPayload | null) {
  const open = new Map<string, StatusPayload["decisions"][number]>();

  for (const decision of data?.decisions ?? []) {
    const symbol = decision.symbol;
    if (!symbol) {
      continue;
    }

    const action = String(decision.action ?? "").toUpperCase();
    const key = competitionTokenKey(symbol);

    if (action === "ENTER") {
      open.set(key, decision);
      continue;
    }

    if (CLOSE_DECISION_ACTIONS.has(action)) {
      open.delete(key);
    }
  }

  return open;
}

function upsertHolding(map: Map<string, WalletHolding>, holding: WalletHolding) {
  const key = competitionTokenKey(holding.symbol);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, holding);
    return;
  }

  const amount = holding.amount ?? existing.amount;
  const held = typeof amount === "number" && amount > 0;

  map.set(key, {
    symbol: existing.symbol || holding.symbol,
    amount,
    valueUsd: holding.valueUsd ?? existing.valueUsd,
    entryValueUsd: existing.entryValueUsd ?? holding.entryValueUsd,
    chain: existing.chain || holding.chain,
    status:
      held || existing.status === "HELD"
        ? "HELD"
        : existing.status === "TRACKED" || holding.status === "TRACKED"
          ? "TRACKED"
          : holding.status,
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
      paperTargetUsd: null,
      mode: null,
      chain: "bsc",
      status: "HELD",
    });
  }

  const balanceRows = [
    ...(data?.wallet.balances ?? []),
    ...portfolioBalancesFromStatus(data).map((balance) => ({
      chain: balance.chain,
      symbol: balance.symbol,
      amount: balance.amount,
      valueUsd: balance.valueUsd,
    })),
  ];

  for (const balance of balanceRows) {
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
      paperTargetUsd: null,
      mode: null,
      chain: balance.chain,
      status: "HELD",
    });
  }

  for (const execution of data?.executions ?? []) {
    const toSymbol = execution.to_symbol;
    if (!toSymbol || !isCompetitionToken(toSymbol) || isQuoteAsset(toSymbol) || !executionSucceeded(execution)) {
      continue;
    }

    const amount =
      execution.expected_amount_out ??
      parseOutputAmount(execution.output) ??
      parseOutputAmount(typeof execution.result?.output === "string" ? execution.result.output : null);

    const key = competitionTokenKey(toSymbol);
    if (holdings.has(key)) {
      const existing = holdings.get(key)!;
      if (existing.entryValueUsd === null && typeof execution.amount_in === "number") {
        upsertHolding(holdings, {
          ...existing,
          entryValueUsd: execution.amount_in,
        });
      }
      continue;
    }

    upsertHolding(holdings, {
      symbol: toSymbol,
      amount,
      valueUsd: null,
      entryValueUsd: typeof execution.amount_in === "number" ? execution.amount_in : null,
      paperTargetUsd: null,
      mode: null,
      chain: "bsc",
      status: "CLOSED",
    });
  }

  for (const [key, decision] of openPositionsFromDecisions(data)) {
    const symbol = decision.symbol;
    if (!symbol || !isCompetitionToken(symbol) || isQuoteAsset(symbol) || isPaperMode(decision.mode)) {
      continue;
    }

    if (holdings.has(key)) {
      const existing = holdings.get(key)!;
      const entry = entryFromDecision(decision);
      if (existing.entryValueUsd === null && existing.paperTargetUsd === null) {
        upsertHolding(holdings, {
          ...existing,
          ...entry,
        });
      }
      continue;
    }

    upsertHolding(holdings, {
      symbol,
      amount: null,
      valueUsd: null,
      ...entryFromDecision(decision),
      chain: "bsc",
      status: "TRACKED",
    });
  }

  return Array.from(holdings.values())
    .filter((holding) => holding.status === "HELD" || (holding.status === "TRACKED" && !isPaperMode(holding.mode)))
    .sort((left, right) => {
      const leftValue = left.valueUsd ?? left.entryValueUsd ?? 0;
      const rightValue = right.valueUsd ?? right.entryValueUsd ?? 0;
      if (left.status !== right.status) {
        const rank = { HELD: 0, TRACKED: 1, CLOSED: 2 };
        return rank[left.status] - rank[right.status];
      }

      return rightValue - leftValue;
    });
}

function paperSignalsFromDecisions(data: StatusPayload | null) {
  return [...openPositionsFromDecisions(data).values()].filter((decision) => isPaperMode(decision.mode));
}

export function walletHoldingsEmptyReason(data: StatusPayload | null): string | null {
  if (data?.connection?.source === "error") {
    return data.connection.error ?? "Telemetry exporter is unreachable.";
  }

  const bscBalances = (data?.wallet.balances ?? []).filter((balance) => balance.chain === "bsc");
  const onlyCash = bscBalances.every((balance) => isQuoteAsset(balance.symbol) || balance.symbol.toUpperCase() === "BNB");

  const paperSignals = paperSignalsFromDecisions(data);
  if (paperSignals.length > 0) {
    const symbols = paperSignals.map((decision) => decision.symbol).filter(Boolean).join(", ");
    const liveBalance =
      typeof data?.wallet.portfolioTotalUsd === "number"
        ? formatUsd(data.wallet.portfolioTotalUsd)
        : "your live TWAK balance";
    return `No real buys yet. Agent is signaling ${symbols} in paper mode only (simulated, not ${liveBalance}).`;
  }

  if (bscBalances.length > 0 && onlyCash) {
    return "Wallet is connected, but BSC holdings are only cash (USDC/BNB). Competition tokens appear here after a successful in-scope buy.";
  }

  if ((data?.wallet.errors?.length ?? 0) > 0) {
    return "Wallet telemetry is partial. Restart the exporter or check TWAK balance reads on EC2.";
  }

  return null;
}

export function formatWalletEntry(holding: WalletHolding) {
  if (holding.entryValueUsd !== null) {
    return formatUsd(holding.entryValueUsd);
  }

  if (holding.paperTargetUsd !== null) {
    return `Paper ${formatUsd(holding.paperTargetUsd)}`;
  }

  return "N/A";
}

export function walletHoldingStatusLabel(holding: WalletHolding) {
  if (holding.status === "TRACKED" && isPaperMode(holding.mode)) {
    return "PAPER";
  }

  return holding.status;
}

export function realActiveTradeCount(data: StatusPayload | null) {
  const fromPositions = data?.positions.positions.length ?? 0;
  if (fromPositions > 0) {
    return fromPositions;
  }

  return boughtTokensFromTelemetry(data).filter((holding) => holding.status === "HELD").length;
}

function formatUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
