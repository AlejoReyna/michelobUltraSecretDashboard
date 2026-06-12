# Session prompt — verify the x402 efficient-flow implementation (Cascade AI / BNB Hack)

Paste as the first message of a fresh session. Ask for folder access to
`~/Documents/BNBHacks` (`cascade-ai` = bot repo local clone,
`cascade-dashboard/cascade-ai-dashboard` = dashboard repo; background:
`X402-FLOW-PROMPT.md` in the dashboard repo is the build brief this work
implements). Live bot: EC2 `34.226.247.39`, systemd `cascade-ai.service`
(User=ec2-user drop-in, WorkingDirectory `/home/ec2-user/cascade-ai` →
symlink `~/nnyb`). Claude has NO ssh — user pastes terminal output; Claude
can fetch `http://34.226.247.39:8787/health?fresh=<epoch>` (always cache-bust).

## Mission
An implementer (separate session) claims all 6 items of the x402 redesign are
built and tested ("328 passed"). Do an independent verification pass — code
review, local test run, then a staged deploy with a 24h observation plan.
Trust nothing from the summary; verify in code. The competition window is
June 22–28; code freeze target June 20.

## What was claimed (verify each)
1. **Disk persistence** — `DualMarketSnapshotCache` persists the paid x402
   layer (snapshot + wall-clock fetched-at) to
   `logs/market_snapshot_cache.json`, restored on startup, TTL math intact.
   Keyless layer intentionally not persisted.
2. **Dust threshold** — `_fetch_snapshot` takes `open_position_value_usdc`
   (sum of `entry_value_usdc`); 1800s in-position TTL only at
   ≥ `X402_MIN_POSITION_VALUE_USDC` (default $5).
3. **Event-driven enrichment** — new `src/data/enrichment_planner.py` runs
   "side-effect-free mirrors" of the two cheap core gates on the keyless
   snapshot; both passing + enriched age > `X402_HOT_REFRESH_AGE_SECONDS`
   (600) forces a paid refresh the same cycle. Flat heartbeat default
   `CMC_SNAPSHOT_TTL_SECONDS` raised 7200→14400.
4. **Scope cut** — paid refresh enriches top `X402_ENRICH_TOP_N=50` by cheap
   rank, always including open-position symbols; keyless overlay keeps all
   ~147 priced in decision_log.
5. **Paid id-preference** — `_fetch_x402_quotes_batch` partitions id-only vs
   ticker-only (id wins on merge), mirroring the keyless split.
6. **Log rename** — keyless line now says `keyless (free, $0.00)`.

## Verification pass (in order)

### A. Code review — known sharp edges
- **Cache-corruption check (most important):** the enrichment planner's gate
  mirrors must NOT call `price_cache.add_data_point` / `volume_cache`
  mutation paths — double-adding points per cycle would skew the rolling
  volume average and corrupt the real `six_hour_high_break` gate. Grep
  `enrichment_planner.py` for any cache writes; confirm it only reads.
- **Threshold uses `entry_value_usdc`:** reconstructed dust rows have
  entry_value 0 → fine, but confirm a real position that has *grown* still
  counts (entry value vs current value — acceptable, just confirm intent),
  and that the sum is computed every cycle, not cached.
- **Persisted cache:** path is cwd-relative (`logs/...`) — fine under
  systemd WorkingDirectory, but confirm `_load` tolerates a corrupt/partial
  file (bot must not crash-loop on bad JSON) and that restore logs
  `Restored persisted x402 snapshot`. Confirm the file is NOT in any frozen
  schema and the exporter doesn't pick it up.
- **Top-50 staleness:** non-top-50 symbols keep keyless data only — confirm
  the high-break gate's `high_3h`/`high_6h` fallback and RSI/derivatives
  fail-closed behavior degrade gracefully for them (informational factors
  fail closed = no entries blocked incorrectly… verify that's still true).
- **Id-preference merge:** confirm merge order (id results override ticker)
  and that the extra paid call only fires when the top-N mix actually
  contains both pinned and unpinned symbols.
- **Frozen schemas untouched:** decision_log.jsonl / execution_log.jsonl /
  positions.json / guardrail_state.json field names unchanged (additive OK).
- **ENV TRAP:** `.env.competition` (and the live `.env` on EC2!) pins
  `CMC_SNAPSHOT_TTL_SECONDS=7200`, which overrides the new 14400 default.
  Implementer said "no env changes required" — that's only true if you
  accept a 2h heartbeat. Decide with the user: update the live `.env` to
  14400 or accept 2h (~$0.36/day flat burn vs ~$0.18).

### B. Local test run (sandbox)
- `python3 -m pytest tests/ -q` — expect ~328 pass; the only acceptable
  failures are the pre-existing ML pair (`test_ml_labels`,
  `test_model_auc`). Anything else failing = stop and fix.
- Targeted: tests for cache persistence, dust threshold, enrichment planner,
  id-split. If any of those four lack a test, write it before deploy.
- Offline functional check: simulate restart (instantiate cache, persist,
  new instance, confirm no refetch within TTL); simulate hot-candidate cycle
  (planner returns force-refresh) and cold cycle (no refresh).

### C. Deploy (one restart — restarts cost a paid refresh until the
persistence file exists on the box)
```bash
# Mac
cd ~/Documents/BNBHacks/cascade-ai
scp -i ~/Downloads/bnbhacks-alexis-key.pem -r src tests ec2-user@34.226.247.39:cascade-ai/
# EC2
cd ~/cascade-ai && PYTHONPATH=. .venv/bin/pytest tests/ -q   # if pytest in venv
sudo systemctl restart cascade-ai
journalctl -u cascade-ai -n 20 --no-pager
```
Then commit both repos' pending work (use author identity from git log).

### D. 24h observation (user pastes, Claude reads)
- `cat ~/cascade-ai/logs/x402_spend.json` — daily spend ≪ $2 (target
  ≤ ~$0.60 worst case).
- After a deliberate second restart: journal shows
  `Restored persisted x402 snapshot`, and NO paid call fires (check spend
  ledger unchanged + no new Basescan payment from `0x9394...42D`:
  https://basescan.org/address/0x939460466a8789c692C88CeC9E28De83a091342D#tokentxns).
- Hot-candidate log lines correlate 1:1 with on-chain payments (timestamps).
- decision_log still shows ~147 candidates priced per cycle; RSI/derivatives
  populate for top-50 after each paid refresh.
- `http://34.226.247.39:8787/health?fresh=<epoch>` → agentRunning true.

## Context you'll need (verified June 12, don't re-derive)
- Wallets: trading `0x7CE2...c9c` (BSC, TWAK keys, ~$11 USDC + dust);
  x402 signer `0x9394...42D` (Base USDC ~$4–5, env `CMC_X402_EPHEMERAL_KEY`,
  official x402 SDK because TWAK 0.17 facilitator rejects Base mainnet).
- Spend governor caps $2/day, $15 total; ledger `logs/x402_spend.json`
  persists across restarts. June 12 it correctly capped at 16:50 UTC.
- Wrong-asset CMC fix is live: 147/148 allowlist priced (was 117), 33 UCIDs
  pinned, knockoff-proof normalizer. 12 ambiguous tokens still unpinned:
  AB, ASTER, BABYDOGE, FORM, M, PENGU, Q, SAHARA, VELO, WLFI, XUSD, ZETA —
  pin if the user supplies UCIDs.
- Sizing: 20% conviction, regime info-only; 6h lookback; 18% kill switch.
- Judging stakes: x402-per-request-in-loop = 10 pts + "most substantive
  x402 usage" tie-breaker (TWAK special prize). Event-correlated payments
  strengthen this; document in submission.

## Constraints (hard)
- Frozen schemas (field names) — additive only.
- TWAK sole execution layer; CMC (keyless + x402) sole data path.
- Claude never executes trades, transfers, or registrations.
- Don't restart the bot more than necessary; batch deploys.

## Parked (carry forward, don't lose)
- Organizer questions unanswered: drawdown basis (peak vs start) + simulated
  fee model → hackathon Telegram.
- June 7 Rango outflows from trading wallet still unconfirmed as user's own —
  re-raise BEFORE the $150–200 funding. Rotate key if not theirs.
- Pre-window: sell dust → fund wallets → `twak compete register` (contract
  `0x212c61b9b72c95d95bf29cf032f5e5635629aed5`, by June 21 06:00 UTC, hold
  non-zero in-scope balance at start) → re-test TWAK-native x402 → demo
  video → DoraHacks submission (promise only what's deployed).
- Dashboard explainer still says regime "halves size" — update to info-only.
- verify_cmc_ids.py v2 not yet re-run on EC2 (cosmetic).

## Working style
Concise. Verify against code/logs before asserting. Exact copy-paste
commands (new shells lose env vars). Cache-bust `/health`. User executes
anything on-chain or money-touching.
