import { z } from "zod";

const nullableNumber = z.number().nullable().optional();

export const factorScoresSchema = z
  .object({
    volume_breakout: z.boolean().optional(),
    six_hour_high_break: z.boolean().optional(),
    regime_not_risk_off: z.boolean().optional(),
    slippage_under_cap: z.boolean().optional(),
    rsi_in_range: z.boolean().optional(),
    derivatives_risk_clear: z.boolean().optional(),
  })
  .partial()
  .catchall(z.boolean().nullable());

export const decisionActionSchema = z.enum(["ENTER", "WAIT", "BLOCKED", "HALT"]);

export const decisionSchema = z
  .object({
    timestamp: z.string(),
    cycle_number: nullableNumber,
    mode: z.string().nullable().optional(),
    portfolio_value_usdc: nullableNumber,
    position_count: nullableNumber,
    entries_allowed: z.boolean().nullable().optional(),
    action: decisionActionSchema,
    symbol: z.string().nullable().optional(),
    position_size_usdc: nullableNumber,
    factor_scores: factorScoresSchema.default({}),
    factor_metrics: z.record(z.string(), z.string()).nullable().optional(),
    true_factor_count: nullableNumber,
    estimated_slippage_pct: nullableNumber,
    reason: z.string().nullable().optional(),
    priced_target_count: nullableNumber,
    strategy_mode: z.enum(["breakout", "scalping"]).nullable().optional(),
    entry_score: nullableNumber,
    entries_blocked_reason: z.string().nullable().optional(),
    exit_reason: z.string().nullable().optional(),
    hold_time_seconds: nullableNumber,
  })
  .passthrough();

export const executionSchema = z
  .object({
    timestamp: z.string(),
    action: z.string().nullable().optional(),
    from_symbol: z.string().nullable().optional(),
    to_symbol: z.string().nullable().optional(),
    amount_in: nullableNumber,
    max_slippage_pct: nullableNumber,
    expected_amount_out: nullableNumber,
    result: z.record(z.string(), z.unknown()).nullable().optional(),
    tx_hash: z.string().nullable().optional(),
    approval_hash: z.string().nullable().optional(),
    explorer: z.string().nullable().optional(),
    input: z.string().nullable().optional(),
    output: z.string().nullable().optional(),
    minReceived: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    priceImpact: z.union([z.string(), z.number()]).nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough();

export const walletBalanceSchema = z
  .object({
    chain: z.string(),
    symbol: z.string(),
    amount: z.number().nullable(),
    valueUsd: z.number().nullable().optional(),
    tokenAddress: z.string().nullable().optional(),
    raw: z.unknown().optional(),
  })
  .passthrough();

export const walletMovementSchema = z
  .object({
    chain: z.string(),
    timestamp: z.string().nullable(),
    action: z.string(),
    fromSymbol: z.string().nullable().optional(),
    toSymbol: z.string().nullable().optional(),
    amountIn: z.number().nullable().optional(),
    output: z.string().nullable().optional(),
    txHash: z.string().nullable().optional(),
    approvalHash: z.string().nullable().optional(),
    explorerUrl: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    source: z.enum(["twak-history", "execution-log", "merged"]),
  })
  .passthrough();

export const walletErrorSchema = z
  .object({
    source: z.string(),
    error: z.string(),
  })
  .passthrough();

export const walletSchema = z
  .object({
    address: z.string().nullable(),
    refreshedAt: z.string(),
    portfolioTotalUsd: z.number().nullable(),
    balances: z.array(walletBalanceSchema).default([]),
    movements: z.array(walletMovementSchema).default([]),
    errors: z.array(walletErrorSchema).default([]),
  })
  .passthrough();

export const positionSchema = z
  .object({
    symbol: z.string(),
    amount_tokens: nullableNumber,
    entry_price: nullableNumber,
    entry_value_usdc: nullableNumber,
    current_price: nullableNumber,
    highest_price: nullableNumber,
    trailing_stop_price: nullableNumber,
    take_profit_price: nullableNumber,
    current_price_at: z.string().nullable().optional(),
    opened_at: z.string().nullable().optional(),
  })
  .passthrough();

export const positionsSchema = z
  .object({
    positions: z.array(positionSchema).default([]),
  })
  .passthrough();

export const guardrailsSchema = z
  .object({
    daily_realized_loss: nullableNumber,
    daily_trade_count: nullableNumber,
    last_reset_date: z.string().nullable().optional(),
    portfolio_ath: nullableNumber,
  })
  .passthrough();

export const x402CallSchema = z
  .object({
    ts: z.string(),
    outcome: z.enum(["success", "failure"]),
    tool: z.string().nullable().optional(),
    amount_usdc: nullableNumber,
    http_status: z.number().nullable().optional(),
    reason: z.string().nullable().optional(),
    daily_spend_usdc: nullableNumber,
    total_spend_usdc: nullableNumber,
  })
  .passthrough();

export const x402SpendLedgerSchema = z
  .object({
    day: z.string().nullable().optional(),
    daily_spend_usdc: z.number().nullable().optional(),
    total_spend_usdc: z.number().nullable().optional(),
  })
  .passthrough();

export type X402SpendLedger = z.infer<typeof x402SpendLedgerSchema>;

export const x402WalletSchema = z
  .object({
    address: z.string().nullable().optional(),
    usdc_balance: z.number().nullable().optional(),
  })
  .passthrough();

export type X402Wallet = z.infer<typeof x402WalletSchema>;

export const sellHistorySchema = z
  .object({
    timestamp: z.string(),
    symbol: z.string(),
    trade_id: z.string().nullable().optional(),
    amount_sold: z.number(),
    balance_before: nullableNumber,
    balance_after: nullableNumber,
    exit_tx_hash: z.string().nullable().optional(),
    exit_reason: z.string().nullable().optional(),
    realized_pnl_usdc: z.number(),
    verified: z.boolean(),
  })
  .passthrough();

export const marketDataRowSchema = z
  .object({
    symbol: z.string(),
    price: nullableNumber,
    previousPrice: nullableNumber,
    priceChangePct: nullableNumber,
    volume: nullableNumber,
    previousVolume: nullableNumber,
    volumeChangePct: nullableNumber,
    updatedAt: z.string().nullable(),
    source: z.enum(["price_cache", "volume_cache", "price_and_volume"]),
  })
  .passthrough();

export type Decision = z.infer<typeof decisionSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type Guardrails = z.infer<typeof guardrailsSchema>;
export type Positions = z.infer<typeof positionsSchema>;
export type WalletBalance = z.infer<typeof walletBalanceSchema>;
export type WalletMovement = z.infer<typeof walletMovementSchema>;
export type WalletTelemetry = z.infer<typeof walletSchema>;
export type X402Call = z.infer<typeof x402CallSchema>;
export type SellHistoryRow = z.infer<typeof sellHistorySchema>;
export type MarketDataRow = z.infer<typeof marketDataRowSchema>;
