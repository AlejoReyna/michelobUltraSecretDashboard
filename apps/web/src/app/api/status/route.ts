import { createMockStatus, createUnavailableStatus } from "@/lib/mock-data";
import { statusSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function json(payload: unknown, init?: ResponseInit) {
  return Response.json(payload, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...init?.headers,
    },
  });
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  const exporterUrl = process.env.AGENT_EXPORTER_URL;
  const token = process.env.AGENT_EXPORTER_TOKEN;
  const forceMock = process.env.USE_MOCK_AGENT_DATA === "true";

  if (forceMock) {
    return json(createMockStatus());
  }

  if (!exporterUrl || !token) {
    return json(
      createUnavailableStatus("Exporter is not configured. Set AGENT_EXPORTER_URL and AGENT_EXPORTER_TOKEN."),
      { status: 503 },
    );
  }

  try {
    const base = exporterUrl.endsWith("/") ? exporterUrl : `${exporterUrl}/`;
    const statusUrl = new URL("status", base);
    statusUrl.searchParams.set("limit", "100");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(statusUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return json(
        createUnavailableStatus(`Exporter returned ${response.status}`),
        { status: 502 },
      );
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
      return json(
        createUnavailableStatus("Exporter response failed validation"),
        { status: 502 },
      );
    }

    return json(parsed.data);
  } catch (error) {
    return json(
      createUnavailableStatus(`Exporter unreachable: ${safeMessage(error)}`),
      { status: 502 },
    );
  }
}
