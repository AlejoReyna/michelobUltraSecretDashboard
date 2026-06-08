const SENSITIVE_VALUE_RE = /(TWAK_WALLET_PASSWORD|password|secret|private key|api[_-]?key|bearer\s+[a-z0-9._-]+|\.env)/i;

export const REDACTED = "[REDACTED]";

function isSensitiveFieldName(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized.includes(".env")) {
    return true;
  }
  if (
    /^(?:password|secret|token|api[_-]?key|private[_-]?key|twak_wallet_password)$/.test(normalized)
  ) {
    return true;
  }
  if (
    /_(?:password|secret|token|api_key|private_key|auth_token|access_token|refresh_token)$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

export function redact<T>(value: T, parentKey = ""): T {
  if (isSensitiveFieldName(parentKey)) {
    return REDACTED as T;
  }

  if (typeof value === "string") {
    return (SENSITIVE_VALUE_RE.test(value) ? REDACTED : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        redact(child, key),
      ]),
    ) as T;
  }

  return value;
}

export function safeError(error: unknown): string {
  if (error instanceof Error) {
    return redact(error.message);
  }

  return redact(String(error));
}
