import type { StatusPayload } from "./schemas";

type MockOptions = {
  error?: string;
  agentRunning?: boolean;
};

const WALLET_ADDRESS = "0x7CE28f5d2D1B2eFd8f87FF0a7fdC7D2EaB465c9c";
const DEMO_SWAP_HASH = "0x2b5db498c97d6c69af6718872feb749457e7e6434c17569a34a2f78ff64eda94";
const DEMO_APPROVAL_HASH = "0x5863c33ba5fbfd7016fae9dfe062d853213b198376862fd76ce81336a20fe7d0";
const SHIB_SWAP_HASH = "0xc69a89ab09634c95e154a95ec903ff587041339673cc5fea287e62c3c9974ecd";
const SHIB_APPROVAL_HASH = "0x448661705d0d4482ab7934f82d981fdde78fbd5f6544fc07ce8f5614a341ef44";
const BASE_X402_HASH = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

export function createMockStatus(options: MockOptions = {}): StatusPayload {
  const agentRunning = options.agentRunning ?? true;

  const decisions = [
    {
      timestamp: isoMinutesAgo(20),
      cycle_number: 121,
      mode: "paper",
      portfolio_value_usdc: 1142.33,
      position_count: 1,
      entries_allowed: true,
      action: "WAIT" as const,
      symbol: "BNB",
      position_size_usdc: 0,
      strategy_mode: "breakout" as const,
      entry_score: 42,
      entries_blocked_reason: null,
      factor_scores: {
        volume_breakout: true,
        six_hour_high_break: false,
        regime_not_risk_off: true,
        slippage_under_cap: true,
        rsi_in_range: true,
        derivatives_risk_clear: true,
      },
      true_factor_count: 5,
      estimated_slippage_pct: 0.0011,
      reason: "entry score 42.0 below threshold 45.0; waiting for stronger reference-high break.",
      priced_target_count: 8,
    },
    {
      timestamp: isoMinutesAgo(10),
      cycle_number: 122,
      mode: "paper",
      portfolio_value_usdc: 1156.89,
      position_count: 1,
      entries_allowed: true,
      action: "ENTER" as const,
      symbol: "CAKE",
      position_size_usdc: 75,
      strategy_mode: "breakout" as const,
      entry_score: 80,
      entries_blocked_reason: null,
      factor_scores: {
        volume_breakout: true,
        six_hour_high_break: true,
        regime_not_risk_off: true,
        slippage_under_cap: true,
        rsi_in_range: true,
        derivatives_risk_clear: true,
      },
      true_factor_count: 6,
      estimated_slippage_pct: 0.0018,
      reason: "entry score 80.0 >= 45.0; slippage under cap (6/6 factors true)",
      priced_target_count: 8,
    },
    {
      timestamp: isoMinutesAgo(1),
      cycle_number: 123,
      mode: "paper",
      portfolio_value_usdc: 1151.72,
      position_count: 2,
      entries_allowed: false,
      action: "BLOCKED" as const,
      symbol: "TWT",
      position_size_usdc: 0,
      strategy_mode: "breakout" as const,
      entry_score: 68,
      entries_blocked_reason: "daily_trade_limit",
      factor_scores: {
        volume_breakout: true,
        six_hour_high_break: true,
        regime_not_risk_off: false,
        slippage_under_cap: true,
        rsi_in_range: true,
        derivatives_risk_clear: false,
      },
      true_factor_count: 4,
      estimated_slippage_pct: 0.0024,
      reason: "entry score 68.0 >= 45.0; guardrails blocked new entries",
      priced_target_count: 8,
    },
  ];

  const executions = [
    {
      timestamp: isoMinutesAgo(10),
      action: "SWAP",
      from_symbol: "USDC",
      to_symbol: "CAKE",
      amount_in: 75,
      max_slippage_pct: 0.5,
      expected_amount_out: 18.43,
      result: { mode: "paper", provider: "twak" },
      tx_hash: "paper-122",
      approval_hash: null,
      error: null,
    },
    {
      timestamp: isoMinutesAgo(55),
      action: "SWAP",
      from_symbol: "USDC",
      to_symbol: "BNB",
      amount_in: 0.5,
      max_slippage_pct: 0.5,
      expected_amount_out: 0.000828458273533057,
      result: {
        mode: "twak",
        provider: "LiquidMesh",
        input: "0.5 USDC",
        output: "0.000828458273533057 BNB",
        minReceived: "0.000820173690797726 BNB",
        priceImpact: "0",
        hash: DEMO_SWAP_HASH,
        tx_hash: DEMO_SWAP_HASH,
        explorer: `https://bscscan.com/tx/${DEMO_SWAP_HASH}`,
      },
      tx_hash: DEMO_SWAP_HASH,
      approval_hash: DEMO_APPROVAL_HASH,
      error: null,
    },
    {
      timestamp: isoMinutesAgo(80),
      action: "entry",
      from_symbol: "USDC",
      to_symbol: "SHIB",
      amount_in: 0.3946445875578817,
      max_slippage_pct: 0.01,
      expected_amount_out: 79956.41978179842,
      result: {
        mode: "twak",
        provider: "LiquidMesh",
        input: "0.3946445875578817 USDC",
        output: "79956.419781798420512432 SHIB",
        fromChain: "bsc",
        toChain: "bsc",
        explorer: `https://bscscan.com/tx/${SHIB_SWAP_HASH}`,
      },
      tx_hash: SHIB_SWAP_HASH,
      approval_hash: SHIB_APPROVAL_HASH,
      error: null,
    },
  ];

  const walletBalances = [
    { chain: "bsc", symbol: "BNB", amount: 0.00241804, valueUsd: 1.61 },
    { chain: "bsc", symbol: "USDC", amount: 7.90520501, valueUsd: 7.91 },
    { chain: "bsc", symbol: "AAVE", amount: 0.0055593743, valueUsd: 0.4 },
    { chain: "bsc", symbol: "SHIB", amount: 174956740.11108723, valueUsd: 0.39 },
    { chain: "base", symbol: "USDC", amount: 0.42, valueUsd: 0.42 },
    { chain: "base", symbol: "x402", amount: 1, valueUsd: null },
  ];

  const walletMovements = [
    {
      chain: "bsc",
      timestamp: isoMinutesAgo(55),
      action: "SWAP",
      fromSymbol: "USDC",
      toSymbol: "BNB",
      amountIn: 0.5,
      output: "0.000828458273533057 BNB",
      txHash: DEMO_SWAP_HASH,
      approvalHash: DEMO_APPROVAL_HASH,
      explorerUrl: `https://bscscan.com/tx/${DEMO_SWAP_HASH}`,
      provider: "LiquidMesh",
      status: "success",
      source: "merged" as const,
    },
    {
      chain: "bsc",
      timestamp: isoMinutesAgo(80),
      action: "entry",
      fromSymbol: "USDC",
      toSymbol: "SHIB",
      amountIn: 0.3946445875578817,
      output: "79956.419781798420512432 SHIB",
      txHash: SHIB_SWAP_HASH,
      approvalHash: SHIB_APPROVAL_HASH,
      explorerUrl: `https://bscscan.com/tx/${SHIB_SWAP_HASH}`,
      provider: "LiquidMesh",
      status: "success",
      source: "execution-log" as const,
    },
    {
      chain: "base",
      timestamp: isoMinutesAgo(130),
      action: "x402 usage",
      fromSymbol: "USDC",
      toSymbol: "CMC",
      amountIn: 0.01,
      output: "market data access",
      txHash: BASE_X402_HASH,
      approvalHash: null,
      explorerUrl: `https://basescan.org/tx/${BASE_X402_HASH}`,
      provider: "TWAK x402",
      status: "success",
      source: "twak-history" as const,
    },
  ];

  return {
    health: {
      ok: true,
      agentRunning,
      pids: agentRunning ? ["2401 python -m src.main"] : [],
      lastLogLine: options.error ?? "cycle complete action=BLOCKED symbol=TWT",
      serverTime: new Date().toISOString(),
      sourcePath: "mock://cascade-ai",
      error: options.error,
    },
    latestDecision: decisions.at(-1) ?? null,
    decisions,
    latestExecution: executions[0] ?? null,
    executions,
    positions: {
      positions: [
        {
          symbol: "BNB",
          amount_tokens: 0.192,
          entry_price: 625.5,
          entry_value_usdc: 120,
          highest_price: 639.2,
          trailing_stop_price: 606.1,
          take_profit_price: 682.4,
          opened_at: isoMinutesAgo(55),
        },
        {
          symbol: "CAKE",
          amount_tokens: 18.43,
          entry_price: 4.07,
          entry_value_usdc: 75,
          highest_price: 4.18,
          trailing_stop_price: 3.9,
          take_profit_price: 4.62,
          opened_at: isoMinutesAgo(10),
        },
      ],
    },
    guardrails: {
      daily_realized_loss: -3.25,
      daily_trade_count: 2,
      last_reset_date: new Date().toISOString().slice(0, 10),
      portfolio_ath: 1194.42,
    },
    balances: {
      bscAddress: {
        ok: true,
        data: { chain: "bsc", address: WALLET_ADDRESS },
      },
      baseAddress: {
        ok: true,
        data: { chain: "base", address: WALLET_ADDRESS },
      },
      portfolio: {
        ok: true,
        data: {
          total_usd: 10.73,
          custody: "local",
        },
      },
      bscBalance: {
        ok: true,
        data: {
          chain: "bsc",
          balances: walletBalances.filter((balance) => balance.chain === "bsc"),
        },
      },
      baseBalance: {
        ok: true,
        data: {
          chain: "base",
          balances: walletBalances.filter((balance) => balance.chain === "base"),
        },
      },
      bscHistory: {
        ok: true,
        data: [
          {
            action: "swap",
            timestamp: isoMinutesAgo(55),
            input: "0.5 USDC",
            output: "0.000828458273533057 BNB",
            provider: "LiquidMesh",
            hash: DEMO_SWAP_HASH,
            explorer: `https://bscscan.com/tx/${DEMO_SWAP_HASH}`,
            status: "success",
          },
        ],
      },
      baseHistory: {
        ok: true,
        data: [
          {
            action: "x402 usage",
            timestamp: isoMinutesAgo(130),
            input: "0.01 USDC",
            output: "market data access",
            provider: "TWAK x402",
            txHash: BASE_X402_HASH,
            explorer: `https://basescan.org/tx/${BASE_X402_HASH}`,
            status: "success",
          },
        ],
      },
    },
    wallet: {
      address: WALLET_ADDRESS,
      refreshedAt: new Date().toISOString(),
      portfolioTotalUsd: 10.73,
      balances: walletBalances,
      movements: walletMovements,
      errors: [],
    },
    x402: {
      instrumented: false,
      paidCallCount: null,
      records: [],
      marketData: [
        {
          symbol: "CAKE",
          price: 11.42,
          previousPrice: 10.98,
          priceChangePct: 4.0073,
          volume: 7600000,
          previousVolume: 5200000,
          volumeChangePct: 46.1538,
          updatedAt: isoMinutesAgo(3),
          source: "price_and_volume",
        },
        {
          symbol: "BNB",
          price: 642.1,
          previousPrice: 639.4,
          priceChangePct: 0.4223,
          volume: null,
          previousVolume: null,
          volumeChangePct: null,
          updatedAt: isoMinutesAgo(3),
          source: "price_cache",
        },
      ],
      marketDataErrors: [],
    },
    files: {
      decisionLog: {
        path: "mock://decision_log.jsonl",
        exists: true,
        sizeBytes: 1384,
        modifiedAt: isoMinutesAgo(1),
      },
      executionLog: {
        path: "mock://execution_log.jsonl",
        exists: true,
        sizeBytes: 612,
        modifiedAt: isoMinutesAgo(10),
      },
      positions: {
        path: "mock://positions.json",
        exists: true,
        sizeBytes: 486,
        modifiedAt: isoMinutesAgo(10),
      },
      guardrails: {
        path: "mock://guardrail_state.json",
        exists: true,
        sizeBytes: 116,
        modifiedAt: isoMinutesAgo(4),
      },
      priceCache: {
        path: "mock://price_cache.json",
        exists: true,
        sizeBytes: 48240,
        modifiedAt: isoMinutesAgo(1),
      },
      volumeCache: {
        path: "mock://volume_cache.json",
        exists: true,
        sizeBytes: 31880,
        modifiedAt: isoMinutesAgo(1),
      },
    },
    connection: {
      source: "mock",
      fetchedAt: new Date().toISOString(),
      error: options.error,
    },
  };
}

export function createUnavailableStatus(error: string): StatusPayload {
  return {
    health: {
      ok: false,
      agentRunning: false,
      pids: [],
      lastLogLine: null,
      serverTime: new Date().toISOString(),
      sourcePath: "unavailable",
      error,
    },
    latestDecision: null,
    decisions: [],
    latestExecution: null,
    executions: [],
    positions: {
      positions: [],
    },
    guardrails: {},
    balances: {},
    wallet: {
      address: null,
      refreshedAt: new Date().toISOString(),
      portfolioTotalUsd: null,
      balances: [],
      movements: [],
      errors: [{ source: "exporter", error }],
    },
    x402: {
      instrumented: false,
      paidCallCount: null,
      records: [],
      marketData: [],
      marketDataErrors: [],
    },
    files: {},
    connection: {
      source: "error",
      fetchedAt: new Date().toISOString(),
      error,
    },
  };
}
