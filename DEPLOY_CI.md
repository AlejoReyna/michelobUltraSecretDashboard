# CI/CD and Deployment Automation

GitHub Actions workflows live under `.github/workflows/`.

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push and PR to `main` | `npm ci`, lint, test, build, security check |
| `deploy.yml` | Manual (`workflow_dispatch`) | Deploy web to Vercel and/or exporter to EC2 |

## Required GitHub secrets

Configure under **Settings → Secrets and variables → Actions** (and optional **Environments** for `production` / `staging`).

### EC2 exporter deploy

| Secret | Description | Example |
|--------|-------------|---------|
| `EC2_HOST` | EC2 public hostname or IP | `ec2-xx-xx.compute.amazonaws.com` |
| `EC2_USER` | SSH user on the instance | `ec2-user` |
| `EC2_SSH_KEY` | Private key (PEM) for deploy user | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `EXPORTER_DEPLOY_PATH` | Dashboard repo path on EC2 | `/home/ec2-user/cascade-ai-dashboard` |

### Vercel web deploy

| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel personal or team token |
| `VERCEL_ORG_ID` | Vercel team or user ID |
| `VERCEL_PROJECT_ID` | Project ID (root directory must be `apps/web`) |

Runtime env vars (`AGENT_EXPORTER_URL`, `AGENT_EXPORTER_TOKEN`, `OPENAI_*`) stay in the Vercel project settings — not in GitHub Actions.

## Deploy workflow inputs

- **target** — `vercel`, `exporter`, or `both`
- **environment** — `production` or `staging`

### Exporter deploy (EC2)

Remote steps:

```bash
git pull --ff-only
npm ci
npm run build:exporter
sudo systemctl restart cascade-ai-exporter
```

Exporter env file `/etc/cascade-ai-exporter.env` is managed on EC2 and is not overwritten by CI.

### Vercel deploy

```bash
npm ci
npm run build:web
npx vercel deploy --prod --cwd apps/web
```

## EC2 prerequisites

Before the first automated exporter deploy:

1. Clone repo to `EXPORTER_DEPLOY_PATH`
2. Create `/etc/cascade-ai-exporter.env` per README
3. Install and enable `cascade-ai-exporter` systemd unit
4. Point `CASCADE_AI_PATH` at the trading agent checkout

## Local parity with CI

```bash
npm ci
npm run lint
npm run test
npm run build
```

Node.js **>= 20.9.0** is required (see `engines` in root `package.json`).

## Manual verification

```bash
# Exporter
curl -s http://localhost:8787/health

# Web (after Vercel deploy)
curl -s https://your-dashboard.vercel.app/api/status
```
