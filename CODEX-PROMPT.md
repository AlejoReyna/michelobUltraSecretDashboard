# Prompt for Codex — patch the cascade-ai trading bot on EC2

Copy everything below the line into Codex.

---

You are working on an EC2 box (Amazon Linux 2023) you can reach with shell access.
The repo is a Python trading bot at `~/cascade-ai` (note: `~/nnyb` may be the same
directory or a second checkout — run `ls -la ~/nnyb ~/cascade-ai` first and work on
the one the running process uses; check with `pgrep -af src.main` and
`ls -l /proc/$(pgrep -f src.main | head -1)/cwd`).

The bot is currently running as `python -m src.main --live --demo-mode`. It competes
in BNB Hack Track 1 (https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail): live
trading on BSC June 22–28, ranked on total return, disqualified above ~30% drawdown,
**minimum 1 trade per day (7 per week) or the agent is not ranked**. Eligible tokens
are a fixed 147-symbol BEP-20 allowlist (already in the repo). BNB itself is NOT on
the allowlist. Execution goes through TWAK (Trust Wallet Agent Kit); market data
comes from CoinMarketCap via x402 micropayments. Keep both — TWAK as sole execution
layer and real x402 usage are judged.

## Observed problem (from 102 logged decisions over 8.3 hours, all live mode)

The bot never enters. Evidence from `decision_log.jsonl`:

1. 100× WAIT, 2× BLOCKED, 0× ENTER. Reasons are all
   `insufficient signal: N/4 core factors passed (need 3)`.
2. The "best candidate" was XAUT (tokenized gold) or USDE (stablecoin) in 73% of
   cycles. They pass `volume_breakout` but can never break a 6-hour price high.
3. `regime_not_risk_off` was `false` in 102/102 cycles — it is a hard veto.
4. `estimated_slippage_pct` was `null` in 101/102 rows; `slippage_under_cap` and
   `six_hour_high_break` passed only in the very first cycle (07:17 UTC) and never
   again. Only 3 unique factor-score combinations exist across the whole run —
   the dynamic data path died after cycle 1 and the failure is being swallowed.
5. `rsi_in_range` and `derivatives_risk_clear` were `true` in 102/102 cycles —
   suspicious; they may default to pass when data is missing.

## Your tasks, in order

### Task 0 — Recon (do not skip)
Map the strategy code before editing:
```bash
grep -rn "core factors passed\|need 3\|core_factor" src/ --include="*.py"
grep -rn "volume_breakout\|six_hour_high_break\|regime_not_risk_off\|slippage_under_cap" src/ --include="*.py" -l
grep -rn "demo" src/ --include="*.py" | grep -iv test
grep -in "error\|warn\|except" agent.log bot_live.log 2>/dev/null | tail -50
```
Report what `--demo-mode` changes. Three positions were opened at startup outside
the decision loop — find that code path.

### Task 1 — Diagnose and fix the data flatline (the real bug)
Find why `estimated_slippage_pct` is never populated after cycle 1 and why
`six_hour_high_break` never recomputes. Likely candidates: a swallowed exception in
the enriched market snapshot refresh (ttl=1800s), a quote that is only requested
after earlier gates pass, or a cache that is read once and never invalidated.
Make data-fetch failures log at WARNING or higher. While there, check whether
`rsi_in_range` and `derivatives_risk_clear` default to `True` on missing data —
if so, make missing data count as a fail and log it.

### Task 2 — Exclude stables/gold from momentum candidate ranking
Where candidates are ranked/selected, filter out:
```python
MOMENTUM_EXCLUDED = {
    "USDT", "USDC", "DAI", "USD1", "USDE", "TUSD", "FDUSD", "USDD",
    "FRAX", "FRXUSD", "USDF", "LISUSD", "XUSD", "EURI", "DUSD",
    "STABLE", "XAUT", "XAUM",
}
```
Compare case-insensitively. They remain valid to HOLD (allowlist unchanged) — they
just must never be selected as momentum entry candidates.

### Task 3 — Demote the regime gate from veto to size modifier
Currently `regime_not_risk_off == false` blocks all entries. Change it so:
- it no longer counts toward (or against) the core-factor entry threshold,
- instead, when regime is risk-off, multiply computed position size by 0.5.
Keep writing the factor's true/false value into `factor_scores` in
`decision_log.jsonl` so the dashboard still renders it.

### Task 4 — Daily compliance trade
The competition requires ≥1 trade/day. In the main cycle loop add: if it is past
22:00 UTC, today's trade count is 0, and no compliance trade has run today, execute
one minimal swap between two allowlisted tokens via the existing TWAK execution
path (e.g. ~$0.50 USDC→TWT). Log it through the normal decision/execution logging
with a reason like `compliance: daily minimum trade`. Never use BNB as either leg.

### Task 5 — Drawdown safety margin
Find the drawdown/kill-switch config. Set the bot's own halt at 18% drawdown from
`portfolio_ath` (competition DQ is ~30%; leave margin). Also ensure the bot never
spends the portfolio below $2 total — hours starting under $1 score 0% in the
competition.

## Hard constraints

- Do NOT change the schema/field names of `decision_log.jsonl`,
  `execution_log.jsonl`, `positions.json`, or `guardrail_state.json` — a separate
  dashboard parses them with strict Zod schemas (`action` must stay one of
  ENTER/WAIT/BLOCKED/HALT; `factor_scores` keys must keep their current names).
  Adding new optional fields is fine.
- Do NOT touch key management, wallet custody, or signing — self-custody via TWAK
  local signing is a judged criterion.
- Do NOT replace TWAK or the x402/CMC data path with other providers.
- Do NOT modify the `agent-exporter` service.
- Keep changes minimal and reviewable; explain each diff.

## Verification (must pass before you finish)

1. `python -m pytest` (or the repo's test command) passes, or explain why not.
2. Restart: `pkill -f src.main; cd <botdir> && nohup .venv/bin/python -m src.main --live >> bot_live.log 2>&1 &`
   (drop `--demo-mode` unless Task 0 shows it is required for safe testing —
   if it gates real execution, say so explicitly and keep it for now).
3. Watch 3+ cycles in `bot_live.log` / `decision_log.jsonl` and confirm:
   - best candidate is no longer a stablecoin/gold token,
   - `estimated_slippage_pct` is numeric on at least some cycles,
   - factor scores vary between cycles (more than 3 unique combinations),
   - decisions show the new sizing behavior when regime is risk-off.
4. Print a summary: files changed, root cause found in Task 1, and the exact
   restart command used.
