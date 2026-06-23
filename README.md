<div align="center">

# NoNamedYet Dashboard

### The read-only operator console for **NoNamedYet_Bot** — a self-custody trading agent built for the [BNB Hack: AI Trading Agent Edition](https://dorahacks.io/hackathon/2162/detail).

`Next.js + Vercel` · `read-only by design` · `zero key access` · `live TWAK telemetry`

</div>

---

> **Part of the [NoNamedYet_Bot](https://github.com/AlejoReyna/no-named-yet-bot) submission** (Track 1 · competing for **Best Use of Trust Wallet Agent Kit**). The agent does the trading and self-custody signing; this dashboard is how you watch it work — safely.

## Why this matters for judging

A self-custody agent is only as trustworthy as its weakest surface. This dashboard is built so that **observing the agent can never compromise it**:

- **It never holds keys and never signs.** No `twak swap`, no mutation endpoints — the exporter only runs an allowlist of read-only TWAK commands (see [Security Notes](#security-notes)).
- **Keys stay on the agent host.** The browser polls a server route, which calls a token-protected EC2 exporter. Provider/API keys and the bearer token never reach the client.
- **Telemetry is redacted at the source.** Recursive redaction strips anything resembling a password, secret, private key, token, or `.env` value before it leaves the box.

That separation is the point: the trading loop's self-custody integrity is preserved end to end, and the operator still gets live wallet, decision, and guardrail visibility.

## Architecture

This repository deploys as two pieces:

- `apps/web`: Next.js App Router dashboard for Vercel.
- `agent-exporter`: small read-only telemetry exporter for the EC2 instance that runs the agent.

The dashboard never talks to the trading bot directly. Browser requests poll `apps/web/src/app/api/status/route.ts`; that server route calls the EC2 exporter with `AGENT_EXPORTER_URL` and `AGENT_EXPORTER_TOKEN`.

`/status` includes normalized read-only wallet telemetry under `wallet`:

- `wallet.address`: TWAK wallet address, read from BSC/Base wallet address commands.
- `wallet.portfolioTotalUsd`: TWAK portfolio total when available.
- `wallet.balances`: normalized BSC/Base token balances.
- `wallet.movements`: merged TWAK history and `execution_log.jsonl` movements. Matching tx hashes are collapsed into one `source: "merged"` row.
- `wallet.errors`: safe read errors from TWAK commands. Failed reads do not blank the dashboard.

The raw redacted TWAK command results remain under `balances` for debugging and backwards compatibility.

## Local Development

Install dependencies:

```bash
npm install
```

Run the dashboard with built-in mock telemetry only when you explicitly want demo data:

```bash
cd apps/web
USE_MOCK_AGENT_DATA=true npm run dev
```

Open `http://localhost:3000`.

Run the exporter against bundled fixtures:

```bash
cd agent-exporter
CASCADE_AI_PATH=./fixtures AGENT_EXPORTER_TOKEN=dev-token VERCEL_DASHBOARD_ORIGIN=http://localhost:3000 npm run dev
```

Then point the web app at it:

```bash
cd apps/web
AGENT_EXPORTER_URL=http://localhost:8787 AGENT_EXPORTER_TOKEN=dev-token npm run dev
```

Useful commands:

```bash
npm run lint
npm run test
npm run build
```

## LLM Integration

Market Intel chat (`/api/chat`) can use OpenAI or Kimi server-side. The browser never sees provider API keys.

Required Vercel env vars for OpenAI:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_FALLBACK_MODEL=gpt-4.1-nano
OPENAI_TIMEOUT_MS=15000
```

Required Vercel env vars for Kimi:

```bash
MARKET_INTEL_PROVIDER=kimi
MOONSHOT_API_KEY=sk-...
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=kimi-k2.6
KIMI_FALLBACK_MODEL=kimi-k2.6
KIMI_THINKING=disabled
MARKET_INTEL_TIMEOUT_MS=15000
MARKET_INTEL_MAX_TOKENS=1200
```

Behavior:

- Every chat message re-fetches live telemetry from the agent-exporter before calling the LLM provider.
- Responses stream as plain text to preserve the terminal typewriter UX.
- If the LLM provider or the exporter is unavailable, the route falls back to the local rule-based `resolveMarketChatResponse()` engine and sets `X-Fallback-Mode: true`.
- Telemetry sent to the LLM provider is trimmed and redacted (no wallet addresses, capped history arrays).
- OpenAI mode uses the Responses API with `store: false`. Kimi mode uses Kimi's OpenAI-compatible Chat Completions API.

Local dev without an LLM key: omit `OPENAI_API_KEY`/`MOONSHOT_API_KEY` and the chat panel uses rule-based fallback automatically.

## Environment Files

Vercel dashboard env (`apps/web/.env.example`):

```bash
AGENT_EXPORTER_URL=
AGENT_EXPORTER_TOKEN=
USE_MOCK_AGENT_DATA=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_FALLBACK_MODEL=gpt-4.1-nano
OPENAI_TIMEOUT_MS=15000
# MARKET_INTEL_PROVIDER=kimi
# MOONSHOT_API_KEY=
# KIMI_BASE_URL=https://api.moonshot.ai/v1
# KIMI_MODEL=kimi-k2.6
# KIMI_FALLBACK_MODEL=kimi-k2.6
# KIMI_THINKING=disabled
# MARKET_INTEL_TIMEOUT_MS=15000
# MARKET_INTEL_MAX_TOKENS=1200
```

EC2 exporter env (`agent-exporter/.env.example`):

```bash
CASCADE_AI_PATH=/home/ec2-user/cascade-ai
AGENT_EXPORTER_TOKEN=change-me
VERCEL_DASHBOARD_ORIGIN=https://your-dashboard.vercel.app
PORT=8787
```

## Vercel Deployment

1. Create a new Vercel project from this repository.
2. Set the project root to `apps/web`.
3. Add `AGENT_EXPORTER_URL` with the HTTPS URL for the EC2 exporter.
4. Add `AGENT_EXPORTER_TOKEN` with the same bearer token configured on EC2.
5. Deploy.

No `NEXT_PUBLIC_` token is used. The token remains server-side in the App Router API route.

## EC2 Exporter Setup

Copy this repository to the EC2 instance, install dependencies, and build the exporter:

```bash
cd /home/ec2-user/cascade-ai-dashboard
npm install
npm run build:exporter
```

Create `/etc/cascade-ai-exporter.env`:

```bash
CASCADE_AI_PATH=/home/ec2-user/cascade-ai
AGENT_EXPORTER_TOKEN=replace-with-a-long-random-token
VERCEL_DASHBOARD_ORIGIN=https://your-dashboard.vercel.app
PORT=8787
HOME=/home/ec2-user
PATH=/home/ec2-user/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
TWAK_BIN=/home/ec2-user/.npm-global/bin/twak
```

If the token contains `$`, escape it for systemd as `$$` (for example `secret$$token`).

Create `/etc/systemd/system/cascade-ai-exporter.service`:

```ini
[Unit]
Description=Cascade AI read-only telemetry exporter
After=network.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/home/ec2-user/cascade-ai-dashboard/agent-exporter
EnvironmentFile=/etc/cascade-ai-exporter.env
ExecStart=/usr/bin/node dist/src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cascade-ai-exporter
sudo systemctl start cascade-ai-exporter
sudo systemctl status cascade-ai-exporter
```

Terminate TLS at a reverse proxy or load balancer and expose only HTTPS to Vercel.

## Exporter Endpoints

- `GET /health`: unauthenticated health check.
- `GET /status`: combined sanitized telemetry.
- `GET /decisions?limit=100`: latest parsed decision JSONL rows.
- `GET /executions?limit=100`: latest parsed execution JSONL rows.
- `GET /positions`: parsed `positions.json`.
- `GET /guardrails`: parsed `guardrail_state.json`.

All routes except `/health` require:

```bash
Authorization: Bearer <AGENT_EXPORTER_TOKEN>
```

## Security Notes

- The exporter has no mutation endpoints.
- The exporter does not start, stop, or signal the bot.
- The exporter does not call `twak swap`.
- The exporter never returns raw environment variables.
- Recursive redaction removes fields containing `password`, `secret`, `private`, `key`, `token`, `TWAK_WALLET_PASSWORD`, or `.env`.
- CORS only allows `VERCEL_DASHBOARD_ORIGIN` plus non-browser server calls.
- The only process command is `pgrep -af src.main`.
- The only TWAK commands are read-only:
  - `twak wallet address --chain bsc --json`
  - `twak wallet address --chain base --json`
  - `twak wallet portfolio --json`
  - `twak wallet balance --chain bsc --json`
  - `twak wallet balance --chain base --json`
  - `twak history --chain bsc --limit 20 --json`
  - `twak history --chain base --limit 20 --json`
- TWAK command failures are returned as safe errors and do not break the dashboard.
- Dashboard refreshes poll only the exporter and must not trigger CMC or x402 payments.

## Verify Read-Only Behavior

Search for mutation risks:

```bash
rg "twak swap|child_process|exec\\(|spawn\\(|POST|PUT|PATCH|DELETE" agent-exporter apps/web
```

Expected:

- No `twak swap`.
- No arbitrary shell command routes.
- No Express mutation routes.
- Only the allowlisted read-only `execFile` calls in the exporter.
- Only `GET` Route Handlers in the web app.

Check exporter auth:

```bash
curl -i http://localhost:8787/status
curl -i -H "Authorization: Bearer dev-token" http://localhost:8787/status
```

Check health remains public:

```bash
curl -i http://localhost:8787/health
```

## Mock Fixtures

The dashboard serves mock telemetry only when `USE_MOCK_AGENT_DATA=true`. If `AGENT_EXPORTER_URL` or `AGENT_EXPORTER_TOKEN` is missing, `/api/status` returns an exporter configuration error instead of demo wallet values. Static fixtures are also included under:

- `agent-exporter/fixtures`
- `apps/web/fixtures`

---

## How the Dashboard Fetches Data

### Polling loop

Every 5 seconds the browser calls `/api/status`. `DashboardClient` owns this loop and clears it on unmount so stale fetches are never applied:

```typescript
// apps/web/src/components/dashboard-client.tsx
useEffect(() => {
  let active = true;

  async function load() {
    const response = await fetch("/api/status", { cache: "no-store" });
    const body = await response.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) throw new Error("Dashboard telemetry failed validation");
    if (!active) return;
    setData(parsed.data);
    setError(parsed.data.connection?.error ?? (response.ok ? null : `HTTP ${response.status}`));
  }

  load();
  const interval = window.setInterval(load, 5000);

  return () => {
    active = false;
    window.clearInterval(interval);
  };
}, []);
```

### API route — `/api/status`

`apps/web/src/app/api/status/route.ts` proxies the request to the EC2 exporter, attaching the bearer token server-side so it never reaches the browser:

```typescript
// apps/web/src/app/api/status/route.ts
const response = await fetch(statusUrl, {
  cache: "no-store",
  signal: controller.signal,
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

The response body is validated against `statusSchema` before being forwarded. A schema mismatch returns HTTP 502 rather than raw exporter output.

### Exporter — `/status` endpoint

On EC2, `getStatus()` in `agent-exporter/src/telemetry.ts` assembles all telemetry in a single `Promise.all`, with TWAK wallet data pre-fetched from an in-process cache:

```typescript
// agent-exporter/src/telemetry.ts
export async function getStatus(sourcePath: string, limit = DEFAULT_LIMIT) {
  requestTwakRefresh("status");            // triggers background TWAK refresh if stale
  const twak = getTwakTelemetrySnapshot(); // returns cached data immediately

  const [health, decisions, executions, x402Calls, x402SpendLedger, x402Wallet,
         sellHistory, hourlyPnl, marketData, positions, guardrails, files] =
    await Promise.all([
      getHealth(sourcePath),
      getDecisions(sourcePath, limit),
      getExecutions(sourcePath, limit),
      getX402Calls(sourcePath, limit),
      getX402SpendLedger(sourcePath),
      getX402Wallet(sourcePath),
      getSellHistory(sourcePath, limit),
      getHourlyPnl(sourcePath),
      getMarketData(sourcePath, limit),
      getPositions(sourcePath),
      getGuardrails(sourcePath),
      fileStatuses(sourcePath),
    ]);
  ...
}
```

### TWAK wallet cache (`agent-exporter/src/twak.ts`)

TWAK commands run via `execFile` from a fixed allowlist — no arbitrary shell access. Commands run **sequentially** to avoid wallet lock races and the result is cached for 5 minutes (`TWAK_CACHE_TTL_MS = 5 * 60 * 1000`). A background refresh fires automatically on every `/status` request when the cache is stale:

```typescript
// agent-exporter/src/twak.ts
async function loadTwakTelemetry(): Promise<TwakTelemetry> {
  // TWAK wallet commands share local state; run sequentially to avoid lock/race failures.
  const telemetry = {} as TwakTelemetry;
  for (const key of TWAK_COMMAND_KEYS) {
    telemetry[key] = await runTwakCommand(key);
  }
  return telemetry;
}
```

If all commands fail the previous cached result is preserved so the dashboard never goes blank.

### View model

`buildViewModel()` transforms the raw `StatusPayload` into a `DashboardViewModel` that every section consumes. It is memoized so it only re-runs when the polled data, a fetch error, or the selected time range changes:

```typescript
// apps/web/src/components/dashboard-client.tsx
const view = useMemo(() => buildViewModel(data, error, timeRange), [data, error, timeRange]);
```

---

### Balance labels

<img width="737" height="74" alt="Screenshot 2026-06-23 at 9 56 02 a m" src="https://github.com/user-attachments/assets/13efdcf5-67b0-404b-93a8-13b0992bde19" />

The four headline metrics are derived inside `buildViewModel()` from the live TWAK snapshot and the strategy’s `decisions`/`executions` arrays:

- **Total Balance** — prefers `wallet.portfolioTotalUsd` (returned by `twak wallet portfolio --json`); falls back to the latest `portfolio_value_usdc` in `decision_log.jsonl`.
- **Position P&L** — window PnL computed in `windowPnl()`: first live-mode decision `portfolio_value_usdc` in the selected time range as the start, and `wallet.portfolioTotalUsd` (or the last decision value) as the end.
- **Active Trades** — count of on-chain or `positions.json` holdings; paper-mode signals are excluded.
- **Execution Rate** — successful executions divided by all resolved execution records from `execution_log.jsonl`.

```typescript
// apps/web/src/components/dashboard-client.tsx — buildViewModel()
metrics: [
  {
    label: "Total Balance",
    value: formatUsd(latest),          // wallet.portfolioTotalUsd → latest decision value
    tooltip: "Live TWAK portfolio total when available; otherwise latest strategy portfolio value.",
  },
  {
    label: "Position P&L",
    value: formatSignedUsd(pnl.absolute),
    delta: windowDelta,
    tone: pnlTone,
  },
  {
    label: "Active Trades",
    value: String(activeTrades ?? 0),
  },
  {
    label: "Execution Rate",
    value: successRate === null ? "N/A" : `${successRate.toFixed(1)}%`,
  },
],
```

The portfolio sparkline is assembled by `chartPoints()`, which filters `decisions` to the active time range and appends the live TWAK total as the final authoritative point:

```typescript
// apps/web/src/components/dashboard-client.tsx — chartPoints()
if (liveTotal !== null) {
  if (Math.abs(lastPoint.value - liveTotal) > 0.005) {
    points.push({ label: "Live", value: liveTotal, timestamp: nowIso });
  }
  return points;
}
```

---

### Positions resume

<img width="469" height="296" alt="Screenshot 2026-06-23 at 9 56 07 a m" src="https://github.com/user-attachments/assets/48922aeb-cda3-4116-8a73-787864e272c1" />

Position data comes from two sources merged in `activePositionRowsFromTelemetry()`:

1. **`positions.json`** on EC2 — read by `getPositions()` in the exporter. Contains entry price, trailing stop, take-profit, and amount for every open trade the strategy is tracking.
2. **Live wallet balances** — tokens flagged `HELD` in `liveWalletBalancesFromTelemetry()` that are not already in `positions.json` appear as wallet-sourced rows (no entry price, but current value is shown).

Current price for each row is derived from the wallet balance (`USD value ÷ token amount`) and merged back into the tracked rows so the P&L columns stay live:

```typescript
// apps/web/src/components/dashboard-client.tsx — activePositionRowsFromTelemetry()
const trackedRows = (data?.positions.positions ?? [])
  .filter((p) => typeof p.amount_tokens === "number" && p.amount_tokens > 0)
  .map((p) => ({
    ...
    currentPrice: p.current_price ?? livePriceByKey.get(competitionTokenKey(p.symbol)) ?? null,
    ...
  }));

const walletRows = holdings
  .filter((h) => h.status === "HELD" && !trackedSymbols.has(competitionTokenKey(h.symbol)))
  .map((h) => ({ symbol: h.symbol, source: "wallet" as const, ... }));

return [...trackedRows, ...walletRows];
```

---

### Logs resume

<img width="483" height="303" alt="Screenshot 2026-06-23 at 9 56 11 a m" src="https://github.com/user-attachments/assets/fd9ec2e3-fde3-49c4-bf29-ef9ea6e48dd2" />

The Activity and Logs panels are populated by `activityFromTelemetry()` and `logRowsFromTelemetry()` respectively. Both work through a priority chain — the richest on-chain data wins:

1. `sellHistory` — verified on-chain sell records from `sell_history.jsonl`
2. `wallet.movements` — TWAK on-chain history merged with `execution_log.jsonl` on matching tx hash
3. `executions` — raw `execution_log.jsonl` rows
4. `decisions` — latest strategy cycle outcomes from `decision_log.jsonl`
5. Agent log line (last line of `agent.log`), or file-existence status as a last resort

```typescript
// apps/web/src/components/dashboard-client.tsx — activityFromTelemetry()
if (sellHistoryRows.length > 0) return sellHistoryRows;
if (movements.length > 0)      return movements;
if (executions.length > 0)     return executions;
if (decisions.length > 0)      return decisions;
// ... last-resort: agent log line or file-check rows
```

The Logs panel (`logRowsFromTelemetry`) shows the full reversed decision history rather than the most recent 7 rows, making it the complete audit trail.

---

### x402 wallet

<img width="453" height="135" alt="Screenshot 2026-06-23 at 9 56 24 a m" src="https://github.com/user-attachments/assets/198a96b8-f9bd-4c9c-888e-0e4f792679b7" />

The Payments panel is assembled from three files on EC2, all read in parallel inside `getStatus()`:

- **`x402_call_log.jsonl`** — one record per paid API call (provider, cost, timestamp).
- **`x402_spend_ledger.json`** — rolling daily and total USDC spend totals.
- **`x402_wallet.json`** — the x402 wallet address and its current USDC balance.

```typescript
// agent-exporter/src/telemetry.ts — getStatus(), x402 assembly
x402: x402Calls.fileMissing
  ? {
      instrumented: false,        // log absent → agent not instrumented for x402
      paidCallCount: null,
      records: [],
      dailySpendUsdc:    x402SpendLedger.data.daily_spend_usdc  ?? null,
      totalSpendUsdc:    x402SpendLedger.data.total_spend_usdc  ?? null,
      walletAddress:     x402Wallet.data.address                ?? null,
      walletUsdcBalance: x402Wallet.data.usdc_balance           ?? null,
      ...
    }
  : {
      instrumented: true,
      paidCallCount: x402Calls.items.length,
      records: x402Calls.items,   // every individual paid API call
      ...
    },
```

When `x402_call_log.jsonl` is absent, `instrumented` is `false` and the panel shows spend totals only. The wallet address and USDC balance are read directly from `x402_wallet.json` — they are never inferred from the TWAK wallet.

## References & links

| | |
| --- | --- |
| **Main agent repo** | [NoNamedYet_Bot](https://github.com/AlejoReyna/no-named-yet-bot) (the submission) |
| **Hackathon** | [BNB Hack: AI Trading Agent Edition](https://dorahacks.io/hackathon/2162/detail) |
| **Trust Wallet Agent Kit** | [portal.trustwallet.com](https://portal.trustwallet.com) |
| **CoinMarketCap AI Agent Hub** | [coinmarketcap.com/api/agent](https://coinmarketcap.com/api/agent) |

<div align="center">

*Read-only by design — so watching the agent never costs you your keys.*

</div>
