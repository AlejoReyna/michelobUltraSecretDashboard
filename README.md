# NoNamedYet Dashboard

Read-only operator console for the NoNamedYet_Bot BSC trading agent. This repository is separate from the trading bot repo and is designed to be deployed as:

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
