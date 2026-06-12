# Bot patch plan — make it trade before June 22

Target: the `cascade-ai` Python repo on EC2 (`~/cascade-ai`, also reachable from `~/nnyb`).
Evidence base: 102 logged decisions (07:17–15:38 UTC, Jun 12), hackathon rules at
https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail.

Why: 0 ENTERs in 8h. Competition requires ≥1 trade/day (7/week) or you are **not ranked**.
Scoring = total return, DQ only above ~30% drawdown. Sitting out = guaranteed $0.

---

## Fix 1 — Stop courting stablecoins (highest impact, smallest diff)

73% of cycles picked XAUT (gold) or USDE (stablecoin) as best candidate. They pass
`volume_breakout` but can never break a 6h price high → permanent WAIT.

Locate the candidate ranking:

```bash
grep -rn "volume_breakout\|best_candidate\|candidates" src/strategy/ --include="*.py" | head
```

Add an exclusion set where candidates are ranked:

```python
MOMENTUM_EXCLUDED = {
    "USDT", "USDC", "DAI", "USD1", "USDE", "TUSD", "FDUSD", "USDD",
    "FRAX", "FRXUSD", "USDF", "LISUSD", "XUSD", "EURI", "DUSD",
    "STABLE", "XAUT", "XAUM",
}
candidates = [c for c in candidates if c.symbol.upper() not in MOMENTUM_EXCLUDED]
```

(They stay on the allowlist for holding/parking — just never as momentum picks.)

## Fix 2 — Regime: hard veto → position-size modifier

`regime_not_risk_off` failed 102/102 cycles. If BTC stays risk-off during June 22–28,
the current bot scores zero and misses the trade minimum.

```bash
grep -rn "risk_off\|regime" src/ --include="*.py"
```

Change two things:
1. Remove regime from the core-factor gate (or force it to count as passed).
2. Where `position_size_usdc` is computed, apply: `size *= 0.5 if regime_risk_off else 1.0`.

Keep logging the regime value so the dashboard still shows it.

## Fix 3 — Find and fix the data flatline (real bug)

After cycle 1, `estimated_slippage_pct` was `null` in 101/101 rows and
`six_hour_high_break` never passed again. Only 3 unique factor-score combos in 8 hours.
Something in the enriched data / quote path died after the first cycle and the
failure is swallowed.

Diagnose:

```bash
grep -in "error\|warn\|except\|traceback" agent.log | tail -40
grep -rn "estimated_slippage" src/ --include="*.py"
grep -rn "six_hour\|6h\|ohlc\|high" src/strategy/ --include="*.py" | head
python3 -c "import json,time,os; p='price_cache.json'; print(time.ctime(os.path.getmtime(p))); d=json.load(open(p)); k=list(d)[0]; print(k, str(d[k])[:200])"
```

Likely suspects, in order:
- Slippage quote is only requested after other gates pass → with Fix 1+2 it may revive itself. Verify a real number appears in `estimated_slippage_pct`.
- 6h-high needs OHLC history; if the enriched snapshot (ttl=1800s) refresh fails silently, the check defaults to `False`. Make that failure log loudly instead of passing.
- Also suspicious: `rsi_in_range` and `derivatives_risk_clear` were `true` 102/102 — check they don't default to pass on missing data. If they do, flip the default or log it.

## Fix 4 — Daily compliance trade (rule floor)

Rule: ≥1 trade/day, 7 over the week. Add to the main loop:

```python
COMPLIANCE_HOUR_UTC = 22

if (now_utc.hour >= COMPLIANCE_HOUR_UTC
        and guardrails.daily_trade_count == 0
        and not compliance_done_today):
    # minimal in-list swap; both legs are eligible tokens
    execute_swap("USDC", "TWT", amount_usdc=0.50)
```

Eligible-list note: **BNB itself is NOT on the 147-token list** — a USDC→BNB swap would
not count. Use USDC→TWT, USDC→CAKE, or similar.

## Fix 5 — Drawdown + dust guardrails

- Set the bot's own max-drawdown halt at **15–20%** (competition DQ is ~30%; leave margin).
- Never let total portfolio drop below ~$2: any hour starting ≤$1 scores 0%.
- Recommended: top up the wallet. At $12, 1%-sized positions are $0.12 — gas + slippage
  + the competition's simulated tx costs will eat the return. $100+ makes sizing sane.

## Fix 6 — Competition checklist (non-code, deadlines)

- [ ] `twak compete register` (or MCP `competition_register`) **before June 22**.
      Verify at https://bsctrace.com/address/0x212c61b9b72c95d95bf29cf032f5e5635629aed5
- [ ] Hold a non-zero balance of in-scope assets at the window start (June 22).
- [ ] Submit on DoraHacks by **June 21**: repo link + demo + strategy explanation.
- [ ] Drop `--demo-mode` for the live window after confirming what it changes:
      `grep -rn "demo" src/ --include="*.py" | grep -iv test`

## Verify after patching

```bash
pkill -f src.main && cd ~/cascade-ai
nohup .venv/bin/python -m src.main --live >> bot_live.log 2>&1 &
tail -f bot_live.log          # expect: varied factor scores, numeric slippage
tail -5 decision_log.jsonl    # expect: non-stable symbols, scores moving, ENTERs
```

Success = within a few cycles, candidates are volatile tokens, `estimated_slippage_pct`
is numeric, and factor counts vary cycle to cycle instead of repeating 3/6.
