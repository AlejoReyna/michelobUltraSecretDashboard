import { createMockStatus, createUnavailableStatus } from "@/lib/mock-data";
import { statusSchema, type StatusPayload } from "@/lib/schemas";

export type ExporterFetchResult = {
  payload: StatusPayload;
  telemetryAgeMs: number;
  source: "mock" | "exporter" | "snapshot" | "error";
};

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchExporterStatus(options?: {
  timeoutMs?: number;
  snapshot?: StatusPayload | null;
}): Promise<ExporterFetchResult> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const forceMock = process.env.USE_MOCK_AGENT_DATA === "true";

  if (forceMock) {
    const payload = createMockStatus();
    return {
      payload,
      telemetryAgeMs: 0,
      source: "mock",
    };
  }

  const exporterUrl = process.env.AGENT_EXPORTER_URL;
  const token = process.env.AGENT_EXPORTER_TOKEN;

  if (!exporterUrl || !token) {
    if (options?.snapshot) {
      const fetchedAt = options.snapshot.connection?.fetchedAt;
      const ageMs = fetchedAt ? Math.max(0, Date.now() - new Date(fetchedAt).getTime()) : 0;
      return {
        payload: options.snapshot,
        telemetryAgeMs: ageMs,
        source: "snapshot",
      };
    }

    return {
      payload: createUnavailableStatus("Exporter is not configured."),
      telemetryAgeMs: 0,
      source: "error",
    };
  }

  const startedAt = Date.now();

  try {
    const base = exporterUrl.endsWith("/") ? exporterUrl : `${exporterUrl}/`;
    const statusUrl = new URL("status", base);
    statusUrl.searchParams.set("limit", "100");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(statusUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Exporter returned ${response.status}`);
    }

    const body = await response.json();
    const parsed = statusSchema.safeParse({
      ...body,
      connection: {
        source: "exporter",
        fetchedAt: new Date().toISOString(),
      },
    });

    if (!parsed.success) {
      throw new Error("Exporter response failed validation");
    }

    return {
      payload: parsed.data,
      telemetryAgeMs: Date.now() - startedAt,
      source: "exporter",
    };
  } catch (error) {
    if (options?.snapshot) {
      const fetchedAt = options.snapshot.connection?.fetchedAt;
      const ageMs = fetchedAt ? Math.max(0, Date.now() - new Date(fetchedAt).getTime()) : 0;
      return {
        payload: options.snapshot,
        telemetryAgeMs: ageMs,
        source: "snapshot",
      };
    }

    return {
      payload: createUnavailableStatus(`Exporter unreachable: ${safeMessage(error)}`),
      telemetryAgeMs: 0,
      source: "error",
    };
  }
}
