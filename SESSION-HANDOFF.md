# Session handoff — Cascade AI / BNB Hack (paste this as the first message)

You are picking up an ongoing engagement mid-flight. Read all of this before acting.
Ask for folder access to BOTH repos before any file work:
`~/Documents/BNBHacks/cascade-dashboard/cascade-ai-dashboard` (dashboard) and
`~/Documents/BNBHacks/cascade-ai` (bot, local clone — the live copy runs on EC2).

## Who/what

I'm competing in **BNB Hack: AI Trading Agent Edition, Track 1 — Autonomous Trading
Agents** (CMC × Trust Wallet, $24k main + $2k "Best Use of TWAK" special prize;
rules: https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail). My agent **Cascade AI**
is a Python trading bot on BSC; a separate Next.js dashboard observes it read-only.

**Hard dates:** trading window **June 22–28**; DoraHacks submission + on-chain
registration (`twak compete register`, contract
`0x212c61b9b72c95d95bf29cf032f5e5635629aed5`) by **June 21**; code freeze target
June 20. Scoring: total return, hourly snapshots, ~30% drawdown DQ (peak-or-start
basis UNKNOWN — open question for organizers), simulated tx costs (model unknown —
second open question), **min 1 trade/day**, hours starting ≤$1 score 0%,
**BNB itself is NOT on the 147-token allowlist** (the published "149" has 2 dupes;
18 of 147 are stables/gold).

## Infrastructure

- **EC2** `34.226.247.39` (Amazon Linux, ssh key `~/Downloads/bnbhacks-alexis-key.pem`,
  user `ec2-user`). Bot dir `/home/ec2-user/cascade-ai` → symlink to `~/nnyb`.
  Bot runs as `nohup .venv/bin/python -m src.main --live` (pid via `pgrep -af src.main`).
  NO systemd unit yet (it already died once when an ssh session closed).
- **Exporter** (read-only telemetry, Express) on EC2 `:8787`, bearer-authed except
  `GET /health`. Claude's sandbox has NO raw TCP (no ssh!) but CAN fetch
  `http://34.226.247.39:8787/health` via the web-fetch tool — **append a changing
  query param (`?fresh=<epoch>`) or you get a stale proxy-cached response**.
  Authed endpoints: have the user run curls (creds in `apps/web/.env.local`,
  AGENT_EXPORTER_URL=http://34.226.247.39:8787) and drop JSON into
  `cascade-ai-dashboard/logs-dump/`.
- **Deploy loop** (Claude cannot ssh): edit the local clone, then user runs
  `scp -i ~/Downloads/bnbhacks-alexis-key.pem -r src .env.competition ec2-user@34.226.247.39:cascade-ai/`
  and restarts with `setsid nohup ... >> bot_live.log 2>&1 < /dev/null &`
  (plain `nohup ... &` over ssh dies with the session).
- **Agent wallet** `0x7CE28f5d2D1B2eFd8f87FF0a7fdC7D2EaB465c9c` (BSC + Base, same
  address). ~$12 total. Holds dust AAVE/LTC/SHIB (~$0.50) bought June 8 — current
  positions.json rows for them are RECONSTRUCTED (synthetic entry prices, fake
  opened_at, SHIB has entry=$0 → broken stops). Plan: sell dust to USDC before
  June 22. Wallet top-up planned: ~$150–200 BSC USDC + BNB gas + ~$25 Base USDC
  (x402 data payments happen on Base).

## Algorithm history (matters for every decision)

- **v1** ran 8.3h on June 12 (102 cycles): **0 entries**. Root causes, all proven:
  stale x402 TTL flatlined 6h-high + slippage data after cycle 1; regime hard-veto
  (`regime_not_risk_off` false 102/102); stablecoins/gold won candidate ranking
  (USDE/XAUT 73% of cycles — a case-normalization bug in STABLE_TARGET_SYMBOLS);
  RSI/derivatives silently passed on missing data (100% pass = no data).
- **v2** (Codex patch, deployed June 12 ~16:19 UTC, verified live): entry = ALL 3
  core gates (`volume_breakout`: 1h vol > 2× hourly avg; `six_hour_high_break`:
  price > rolling-cache high × 1.002 — **NOTE: lookback is actually 3h**
  (`breakout_lookback_hours=3`), name is a lie; `slippage_under_cap`: TWAK quote
  <1%, only quoted when both momentum gates pass). Regime now halves size instead
  of vetoing. RSI/derivatives informational, fail closed. `MOMENTUM_EXCLUDED`
  blocks 18 stables/gold from ranking. Compliance swap ~$0.50 USDC→TWT at 22:00 UTC
  if 0 trades that day (never BNB legs). Drawdown kill switch 18%. $2 portfolio floor.
- Schemas are FROZEN: decision_log.jsonl / execution_log.jsonl / positions.json /
  guardrail_state.json field names must not change (dashboard Zod parses them).
  TWAK must stay sole execution layer; x402/CMC sole data path (judged criteria).
  Self-custody throughout. Exporter/dashboard stay read-only.

## Work already done (don't redo)

- Dashboard explainer + docs updated to v2 (3-core-gate copy, regime=size modifier,
  18% kill switch, compliance trade) in `factor-scoring.ts`, `log-event-details.ts`,
  `decision-algorithm-panel.tsx`, `mock-data.ts`, `docs/TRADING-ALGORITHM.md`.
  tsc + eslint clean. NOT yet committed (check `git status`).
- Desktop **Active Positions redesign** implemented in `dashboard-client.tsx`:
  summary stat strip (count, total value, nearest stop/target), 21px symbols/16px
  numerics, price-corridor bar per row (stop→target track, entry/high ticks),
  rows are real `<a>` links to BscScan (matched execution tx → /tx/{hash}; fallback
  wallet `#tokentxns`; SHIB $0 rows guarded to N/A). Mobile/compact path untouched.
- Reference docs in dashboard repo root: `BOT-PATCH-PLAN.md`, `CODEX-PROMPT.md`
  (both executed), `SWARM-AUDIT-PROMPT.md` (executed by Kimi), `UI-POSITIONS-PROMPT.md`
  (implemented by Claude), this file.
- `logs-dump/` has June 12 telemetry snapshots (decisions/executions/positions/
  guardrails/wallet JSON).

## Kimi audit triage (user has `audit.pdf`; Claude already assessed it)

**Confirmed, ship these (S-effort):** regime threshold recalibration (proposal
−3% BNB 1h / 0% token 1h / −15% token 24h; current −1%/+0.25%/−8% never passed in
102 cycles); price_cache warm-up seeding on startup (else first ~3h of the window
has zero high-break passes after a restart); 10s timeout on TWAK quote/exec calls;
persist compliance marker to disk (verify first — may be RAM-only `_last_compliance_trade_day`);
`reconstructed: true` flag + defer trailing-stop updates one cycle; systemd unit
with Restart=always; liquidity floor in ranking; rename factor or set lookback to
match "6h" name; momentum-z-score ranking instead of raw 24h volume.

**Refuted / do not trust:** Kimi's gas figures ($0.10–0.30/tx — actual BscScan fees
are $0.002–0.05, ~10× lower, so its "$5 minimum viable trade" table is wrong);
its claim DQ drawdown is "measured from peak" (it contradicts itself — unknown,
ask organizers); bug "MIN_ENTRY_FACTORS env default 4" (harmless —
`min(settings.min_entry_factors, CORE_FACTOR_COUNT)` clamps to 3); `twak policy set
--allow-tokens` CLI syntax (unverified, possibly invented — check TWAK docs before
building the rubric story on it); its Monte Carlo entry/return tables (directional
only); `price_cache._seed_high()` API (doesn't exist).

**Open decision for the user (do not decide for them):** position sizing.
Options: keep 5% max + regime halving (too small — fee drag), 10–12% middle path,
or 15–25% conviction sizing with regime as info-only (Kimi's #1, highest variance).

## Immediate next steps (where we left off)

1. Verification pass over the bot repo for the unconfirmed Kimi claims
   (compliance marker persistence, TWAK call timeouts, `is_liquid` thresholds).
2. Write/apply the confirmed patch set (local clone → scp → restart), respecting
   frozen schemas. Get the sizing decision from the user first.
3. 24h observation run, then pre-window checklist: sell dust positions, fund
   wallet, `twak compete register`, systemd, demo video (shot list exists in
   SWARM-AUDIT-PROMPT output), DoraHacks submission text (draft exists, but it
   promises 20% sizing + TWAK policy layer — only submit what's actually deployed).
4. Post 2 questions in the hackathon Telegram: drawdown basis (peak vs start) and
   the simulated fee model.

## Working style

Be concise. Verify claims against code/logs before asserting. The user pastes
terminal output when Claude can't reach something; offer exact copy-paste commands
(remember: new terminal sessions lose env vars like $KEY). When checking
`/health`, always cache-bust. Don't start trades, transfers, or registrations —
those are the user's to execute.
