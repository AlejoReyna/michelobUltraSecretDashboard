import type { StatusPayload } from "@/lib/schemas";

export type AgentLogView = {
  line: string | null;
  source: string | null;
  stale: boolean;
};

function logFileModifiedAt(data: StatusPayload | null, source: string | null): string | null {
  if (!data?.files) {
    return data?.health.lastLogModifiedAt ?? null;
  }

  const key = source === "bot_live.log" ? "botLiveLog" : "agentLog";
  return data.files[key]?.modifiedAt ?? data.files.agentLog?.modifiedAt ?? data.health.lastLogModifiedAt ?? null;
}

function decisionReferenceTime(data: StatusPayload | null): string | null {
  return data?.files?.decisionLog?.modifiedAt ?? data?.latestDecision?.timestamp ?? null;
}

function isOlderTimestamp(left: string, right: string): boolean {
  return new Date(left).getTime() < new Date(right).getTime();
}

export function resolveAgentLogLine(data: StatusPayload | null): AgentLogView {
  if (data?.health.lastLogStale) {
    return {
      line: null,
      source: data.health.lastLogSource ?? null,
      stale: true,
    };
  }

  const line = data?.health.lastLogLine?.trim() ?? null;
  const source = data?.health.lastLogSource ?? null;

  if (!line) {
    return { line: null, source, stale: false };
  }

  const logModifiedAt = logFileModifiedAt(data, source);
  const decisionModifiedAt = decisionReferenceTime(data);

  if (logModifiedAt && decisionModifiedAt && isOlderTimestamp(logModifiedAt, decisionModifiedAt)) {
    return { line: null, source, stale: true };
  }

  return { line, source, stale: false };
}
