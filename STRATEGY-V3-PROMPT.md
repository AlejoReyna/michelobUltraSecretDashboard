# Session prompt — Strategy v3: from binary gates to scored entries (Cascade AI / BNB Hack)

Paste as the first message of a fresh session. Ask for folder access to
`~/Documents/BNBHacks` (`cascade-ai` = bot repo, `cascade-dashboard/cascade-ai-dashboard`
= dashboard repo; sibling docs `X402-FLOW-PROMPT.md` and `X402-FLOW-TEST-PROMPT.md`
cover the data layer, which is DONE and verified — do not redesign it).
Live bot: EC2 `34.226.247.39`, systemd `cascade-ai.service`. Claude has no ssh;
user pastes terminal output. Health: `http://34.226.247.39:8787/health?fresh=<epoch>`
(always cache-bust). Hard dates: code freeze June 20, window June 22–28.

## Why this session exists
June 12 decision-log analysis (164 decisions, `logs-dump/decisions-evening.json`
in the dashboard repo — load it, it's the evidence base):
- The 3-core-AND entry (volume_breakout && six_hour_high_break &&
  slippage_under_cap) fired **once in 14 hours** (AAVE 07:17). At that rate
  the window produces ~0–2 entries/week — compliance swaps will satisfy the
  1-trade/day minimum, but you cannot win on dust swaps.
- Gate pass rates are wildly uneven: volume_breakout ~75%,
  six_hour_high_break ~13%, and they almost never overlap; slippage is only
  quoted after both pass, so it shows 1%.
- **BLOCKER, fix first:** every decision all day was
  `action: BLOCKED, entries_allowed: false` — including the AAVE full-pass.
  Something global (suspect #1: the disk guard — entries silently blocked
  when EC2 root volume has <500MB free; see `disk_allows_entries` /
  `check_disk_guard` in `src/deployment/`, called at `src/main.py:523`).
  Diagnose with `df -h /`, the bot log, and `guardrail_state.json` BEFORE
  touching strategy. Whatever the cause: blocked entries MUST log their
  reason (additive `entries_blocked_reason` field in decision rows is
  schema-safe; Zod ignores unknown fields).

## Mission
Replace the all-or-nothing gate chain with a **scored entry model** that
would have produced ~3–6 entries/day on June 12 data, plus four upgrades
adapted from competitor analysis (Binacci) — without breaking frozen
schemas, the x402 story, or the drawdown discipline. x402 stays load-bearing:
paid enrichment is what feeds RSI/derivatives into the score, and the
hot-candidate forced refresh must remain wired so payments correlate with
entry decisions (judged: "x402 in the trade loop", tie-break "most
substantive x402 usage").

## Design (agreed with user June 12)

### 1. Scored entries replace the 3-AND gate
- Keep `slippage_under_cap` as the ONLY hard gate (TWAK quote <1%, quoted
  when score is near-threshold — this keeps the x402→quote→entry chain).
- Everything else becomes a weighted score per candidate, e.g.:
  breakout strength (price vs reference highs, see #4) ~35%, volume surge
  (1h vol / hourly avg, capped) ~25%, cross-sectional momentum z-score
  (already implemented in `_momentum_z_scores`) ~20%, RSI in 55–75 band
  ~10%, derivatives clear ~10%. Missing paid data degrades the component to
  0, never blocks (fail-soft for optional, fail-closed stays for slippage).
- Enter the top-scoring candidate when score ≥ threshold. Calibrate the
  threshold by REPLAYING June 12 keyless data so that day yields ~3–6
  entries (write a small replay script against the decisions dump +
  price_cache; do not guess the threshold).
- FROZEN-SCHEMA RULE: `factor_scores` keys (volume_breakout,
  six_hour_high_break, regime_not_risk_off, slippage_under_cap,
  rsi_in_range, derivatives_risk_clear) keep being logged with their
  boolean meanings. Add `entry_score` as an ADDITIVE field. The dashboard
  explainer copy will be updated separately — note it in the handoff.

### 2. Macro regime context (adapted from Binacci's macro gate, info-only)
- CMC keyless `/v1/global-metrics/quotes/latest` (the bot already hits
  global metrics for derivatives) → total_market_cap trend, btc_dominance
  delta, stablecoin dominance delta; Fear & Greed if cheap.
- Maintain a small persisted ring (24h) like Binacci's `_macro_history` —
  pattern already exists in `LocalCache`.
- Output: a macro multiplier on position size in [0.5, 1.0] and a score
  component, NEVER a veto (v1 died from regime vetoes; regime stays
  info-only per user decision).

### 3. Anti-chase cap
- Skip entry when price > broken_reference_high × (1 + X), X env
  `MAX_CHASE_PCT` default ~0.04. One condition at decision time. This is
  the drawdown protector that lets conviction sizing (20%) survive spikes.

### 4. Reference memory (multi-window highs)
- Extend the persisted price cache to expose rolling highs for 3h/6h/24h
  (data already collected every 5 min; just compute max over windows).
- Breakout strength component = fraction of windows cleared, weighted by
  window length. Feeds the score (#1) and quote-priority ranking. The
  frozen `six_hour_high_break` boolean keeps its current 6h definition.

### 5. Stepped trailing stop
- In `PositionManager.update_price`: unrealized ≥ +8% → trail 6%→4%;
  ≥ +12% → 3% (envs STEP1/STEP2 with these defaults). `trailing_stop_price`
  field already exists; reconstructed-row deferral logic must be preserved.

### NOT in scope (deliberate, don't let the implementer add them)
- No averaging-down, no perps, no candle synthesis/multi-TF sims, no new
  data vendors (CMC keyless + x402 only; TWAK sole execution), no schema
  field renames, no changes to the spend governor or enrichment planner
  beyond feeding macro/score inputs.

## Order of work
1. Diagnose + fix the entries_allowed blocker (evidence first; likely disk).
   Add blocked-reason logging. Deploy this alone if it's a quick fix — the
   bot is currently incapable of trading regardless of strategy.
2. Replay harness: score June 12 data, calibrate threshold + weights to
   3–6 entries/day. Keep the harness in `scripts/` (judges like evidence).
3. Implement #1–#5 with tests (engine tests exist:
   `tests/test_breakout_engine.py` pattern). Local suite green
   (expect ~330 passed; the 2 ML failures are pre-existing sandbox issues).
4. Deploy once (scp src+tests → restart; restarts are cheap now — the
   snapshot cache persists), verify cycle logs show scores, then a 48h
   observation run before the freeze: target ≥3 would-be entries/day in
   logs, zero crashes, paid x402 calls correlating with hot candidates.
5. Update `docs/TRADING-ALGORITHM.md` + flag dashboard explainer copy for
   the scored model (separate dashboard session handles UI copy).

## Live-state facts (June 12 night, verified — don't re-derive)
- Data layer v2: 147/148 allowlist priced keyless; paid x402 = id-only
  calls (symbol-only is rejected AFTER settling payment — never reintroduce),
  columnar headers+rows parser, top-50 enrichment scope, disk-persisted
  snapshot cache, BNB reference fetch is keyless-only (was a $0.01/cycle
  leak). Spend governor capped 2.50 today (TEMP — revert to 2.00 with next
  deploy), ledger `logs/x402_spend.json`, signer `0x9394...42D` ~$4 Base USDC.
- Sizing 20% conviction, regime multiplier 1.0 (info-only), 6h lookback,
  kill switch 18%, $2 floor, 15s TWAK quote timeout.
- positions.json has 3 dust rows flagged `reconstructed: true`; dust
  (<$5 total) correctly does not trigger the in-position TTL.
- guardrail morning state: ATH 11.50 vs portfolio ~11.0 (no kill switch).

## Parked list (carry in the handoff, do not drop)
Organizer questions (drawdown basis, fee model) → Telegram; sell dust;
fund wallets (~$150–200 BSC USDC + BNB gas, top signer to ~$10) — but FIRST
user must confirm June 7 Rango outflows were theirs (else rotate keys);
`twak compete register` by June 21 06:00 UTC (hold non-zero in-scope balance
at start); re-test TWAK-native x402; pin UCIDs for AB ASTER BABYDOGE FORM M
PENGU Q SAHARA VELO WLFI XUSD ZETA when user supplies them; demo video;
DoraHacks submission text (promise only what's deployed; include the
"paying x402 vs describing x402" contrast and the spend-governor story).

## Working style
Concise. Verify against code/logs before asserting. Exact copy-paste
commands. Cache-bust `/health`. User executes anything on-chain or
money-touching. Never start trades/transfers/registrations.
