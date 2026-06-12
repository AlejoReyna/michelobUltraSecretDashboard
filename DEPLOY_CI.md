# CI/CD and Deployment Automation

GitHub Actions workflows live under `.github/workflows/`.

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push and PR to `main` | `npm ci`, lint, test, build, security check |
| `aws-deploy.yml` | Manual (`workflow_dispatch`) | Recommended AWS deploy: Amplify web app and/or EC2 exporter through SSM |
| `deploy.yml` | Manual (`workflow_dispatch`) | Legacy deploy: web to Vercel and/or exporter to EC2 over SSH |

## Recommended AWS deploy

Configure under **Settings → Secrets and variables → Actions** (and optional **Environments** for `production` / `staging`).

### GitHub secret

| Secret | Description | Example |
|--------|-------------|---------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role assumed by GitHub Actions through OIDC | `arn:aws:iam::123456789012:role/github-cascade-dashboard-deploy` |

### GitHub variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for Amplify and SSM | `us-east-1` |
| `AMPLIFY_APP_ID` | AWS Amplify app ID for the Next.js web app | Required for `amplify-web` |
| `AMPLIFY_BRANCH_NAME` | Amplify branch to release | `main` |
| `EXPORTER_SSM_INSTANCE_ID` | EC2 instance ID managed by SSM | Required for `exporter` |
| `EXPORTER_DEPLOY_USER` | Linux user that owns the dashboard checkout | `ec2-user` |
| `EXPORTER_DEPLOY_PATH` | Dashboard repo path on EC2 | `/home/ec2-user/cascade-ai-dashboard` |
| `EXPORTER_SERVICE_NAME` | systemd service name for the exporter | `cascade-ai-exporter` |
| `EXPORTER_HEALTH_URL` | Local exporter health endpoint checked after restart | `http://localhost:8787/health` |

### AWS prerequisites

1. Add GitHub's OIDC provider in IAM for `https://token.actions.githubusercontent.com`.
2. Create `AWS_DEPLOY_ROLE_ARN` with a trust policy limited to this repo and the GitHub Environment you deploy from.
3. For exporter deploys, attach permissions for `ssm:SendCommand` on the EC2 instance and `AWS-RunShellScript`, plus `ssm:GetCommandInvocation`.
4. For web deploys, connect the GitHub repo to AWS Amplify, set the app root to `apps/web`, and allow `amplify:StartJob` / `amplify:GetJob` on the app branch.
5. Attach an EC2 instance profile that allows Systems Manager to manage the exporter host, and confirm the instance is online in SSM Fleet Manager.

Example role trust condition for a GitHub Environment:

```json
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:environment:production"
  }
}
```

Minimum SSM exporter permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:REGION:ACCOUNT_ID:instance/INSTANCE_ID",
        "arn:aws:ssm:REGION::document/AWS-RunShellScript"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

Minimum Amplify permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "amplify:StartJob",
        "amplify:GetJob"
      ],
      "Resource": [
        "arn:aws:amplify:REGION:ACCOUNT_ID:apps/APP_ID/branches/BRANCH_NAME",
        "arn:aws:amplify:REGION:ACCOUNT_ID:apps/APP_ID/branches/BRANCH_NAME/jobs/*"
      ]
    }
  ]
}
```

Runtime env vars (`AGENT_EXPORTER_URL`, `AGENT_EXPORTER_TOKEN`, `OPENAI_*`) stay in AWS Amplify environment variables or on EC2 — not in GitHub Actions.

## Legacy deploy secrets

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

For `aws-deploy.yml`, **target** is `amplify-web`, `exporter`, or `both`.

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
