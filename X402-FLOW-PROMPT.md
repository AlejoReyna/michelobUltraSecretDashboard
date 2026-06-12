# Session prompt — x402 efficient-flow redesign (Cascade AI / BNB Hack)

Paste this as the first message of the next session. Ask for folder access to
`~/Documents/BNBHacks` (both repos live under it: `cascade-ai` = bot local
clone, `cascade-dashboard/cascade-ai-dashboard` = dashboard). The live bot
runs on EC2 `34.226.247.39` under systemd (`cascade-ai.service`, drop-in adds
User=ec2-user + PATH with `/home/ec2-user/.npm-global/bin`). Claude has no
ssh — user pastes terminal output; Claude can cache-bust-fetch
`http://34.226.247.39:8787/health?fresh=<epoch>`.

## Mission
Replace timer-driven x402 spending with event-driven enrichment so the paid
data budget lasts the whole June 22–28 trading window (~$1–3 total instead of
$2/day), without weakening the judged "native x402 in the trade loop" story.

## State as of June 12 evening (all verified, don't re-derive)
- Two-wallet design confirmed: trading wallet `0x7CE2...c9c` (BSC, keys in
  TWAK) and x402 payment signer `0x9394...42D` (Base USDC, env
  `CMC_X402_EPHEMERAL_KEY`, signs via official x402 SDK because TWAK 0.17's
  facilitator rejects Base mainnet — see docstring in `src/data/x402_client.py`).
  Signer has roughly $4–5 left; trading wallet ~$11 BSC USDC + dust.
- Paid call = enriched snapshot refresh = 3 batches (147 symbols / batch 50)
  × $0.01. Spend governor (`src/data/x402_spend_governor.py`, ledger
  `logs/x402_spend.json`) capped today at $2.00 by 16:50 UTC → keyless-only
  till UTC midnight. Cap works; cadence is the problem: dust positions
  (LTC/SHIB/AAVE, ~$0.50 total) put the bot on the 1800s in-position TTL, and
  every restart cold-starts the RAM snapshot cache → immediate paid refresh.
- The every-5-min log line `Built x402 quotes-only snapshot` is the FREE
  keyless path (misleading name, `_snapshot_from_quotes` in
  `src/data/cmc_mcp_client.py:551`) — costs $0.00. Don't chase it again.
- June 12 fixes already deployed + committed (local commits `b40d02e`,
  `3e903e1`, pushed through `3d3d7ed`): conviction sizing 20%
  (`MAX_POSITION_PCT=0.20`, `REGIME_SIZE_MULTIPLIER=1.0` = regime info-only),
  6h lookback, regime thresholds −3%/0%/−15%, 15s TWAK quote timeout,
  `reconstructed` position flag, systemd unit, and the wrong-asset CMC fix
  (id-preferred keyless queries + knockoff-proof normalizer + 33 pinned
  UCIDs) → **147/148 allowlist tokens priced** (was 117; DOGE resolved to
  "Doge Grok Companion" before).

## Why this matters for judging (from the DoraHacks rules, re-read June 12)
TWAK special prize: x402-per-request-in-trade-loop is worth 10 pts ("real,
not a README mention"), TWAK integration depth 30 pts (x402 listed as a TWAK
surface), tie-breaker = "most substantive x402 usage". So: keep a real,
visible on-chain payment stream, make each payment *decision-relevant*, and
re-test TWAK-native x402 before June 21 (if still Base-broken, document the
attempt in the submission).

## Build this (in order)
1. **Disk-persisted snapshot cache.** `src/data/market_snapshot_cache.py` is
   RAM-only; persist enriched snapshot + fetched-at timestamp (pattern:
   `LocalCache` in breakout_engine). Restarts must not trigger a paid refresh
   while the TTL is still fresh. (Today's crash loop alone paid ~6 batches.)
2. **Dust doesn't count as "in position".** The 1800s in-position TTL should
   require total open-position value above a threshold (env, default ~$5).
   Position values are available where the TTL is chosen (grep
   `X402_IN_POSITION_TTL_SECONDS` / `market_snapshot_cache` callers in
   `src/main.py`).
3. **Event-driven enrichment.** Trigger a paid refresh when (a) any candidate
   passes ≥2 cheap core gates this cycle and the enriched snapshot is older
   than ~10 min, or (b) entering/holding a real position (per #2), else (c)
   heartbeat: flat TTL 2h→4h is fine (`CMC_SNAPSHOT_TTL_SECONDS=14400`).
   Expected burn: ~$0.15–0.50/day worst case.
4. **Scope cut (optional, biggest single saver):** enrich only top ~50
   candidates by cheap rank instead of all 147 → 1 paid batch instead of 3.
   The 147 stay fully scanned by the FREE keyless path every 5 min — this
   changes paid enrichment scope only, never universe visibility.
5. **Paid path id-preference.** `_fetch_x402_quotes_batch` still sends
   id+symbol to the MCP server; mirror the keyless id-preferred split so we
   never pay $0.01 for knockoff data.
6. **Log-label cleanup:** rename the "x402 quotes-only" log line to say
   keyless. Two people lost an hour to it.

## Constraints (unchanged, hard)
- Frozen schemas: decision_log.jsonl / execution_log.jsonl / positions.json /
  guardrail_state.json field names (additive fields OK — dashboard Zod
  ignores unknowns; `reconstructed` already added).
- TWAK = sole execution layer; CMC (keyless + x402) = sole market-data path.
- Exporter/dashboard stay read-only. Claude never starts trades/transfers/
  registrations.
- Deploy loop: edit local clone → user scp's `src` (and `.env.competition` if
  changed) → `sudo systemctl restart cascade-ai`. Remember restarts currently
  cost a paid refresh until #1 ships — batch deploys.

## Verify after deploy
- `logs/x402_spend.json` daily spend stays ≪ $2 over 24h observation.
- On-chain: payments from `0x9394...42D` to CMC become event-correlated
  (check https://basescan.org/address/0x939460466a8789c692C88CeC9E28De83a091342D#tokentxns).
- decision_log still shows 147 candidates priced per cycle; RSI/derivatives
  populate after each paid refresh.
- pytest: tests/test_cmc_mcp_parse.py, test_cmc_mcp_fallback.py + add tests
  for cache persistence and the dust threshold.

## Parked items (don't lose)
- Pin UCIDs for 12 ambiguous tokens when user supplies them from CMC pages:
  AB, ASTER, BABYDOGE, FORM, M, PENGU, Q, SAHARA, VELO, WLFI, XUSD, ZETA.
  (NFT=9816 shows name "AINFT" — believed APENFT rebrand, same asset; sanity
  check price vs apenft listing once.)
- verify_cmc_ids.py v2 (production price reader) edited locally; not yet
  re-run on EC2.
- Possible key-compromise question CLOSED only if user confirmed the June 7
  Rango outflows (6 USDC Base→?) were theirs — if unconfirmed, re-raise
  before funding $150–200.
- Pre-window checklist: sell dust → fund BSC wallet (~$150–200 USDC + BNB
  gas) and top signer to ~$10 Base USDC → `twak compete register` (contract
  `0x212c61b9b72c95d95bf29cf032f5e5635629aed5`, deadline June 21 06:00 UTC,
  must hold non-zero in-scope balance at start) → re-test TWAK-native x402 →
  demo video + DoraHacks submission (only promise what's deployed).
- Ask organizers in Telegram: drawdown basis (peak vs start) and the
  simulated fee model. Still unanswered.
- Dashboard explainer still says regime "halves size" — update to info-only.

## Working style
Concise. Verify against code/logs before asserting. Exact copy-paste commands
(new shells lose env vars). Cache-bust `/health`. The user runs anything
on-chain or money-touching themselves.
