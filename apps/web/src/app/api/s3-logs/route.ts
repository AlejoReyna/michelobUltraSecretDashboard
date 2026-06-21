export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

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

async function proxyToExporter(path: string, token: string, exporterUrl: string) {
  const base = exporterUrl.endsWith("/") ? exporterUrl : `${exporterUrl}/`;
  const url = new URL(path, base);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return json(
        { ok: false, error: `Exporter returned ${response.status}` },
        { status: 502 },
      );
    }

    const body = await response.json();
    return json(body);
  } catch (error) {
    clearTimeout(timeoutId);
    return json(
      { ok: false, error: `Exporter unreachable: ${safeMessage(error)}` },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const exporterUrl = process.env.AGENT_EXPORTER_URL;
  const token = process.env.AGENT_EXPORTER_TOKEN;
  const forceMock = process.env.USE_MOCK_AGENT_DATA === "true";

  if (forceMock) {
    return json({
      ok: true,
      objects: [],
      prefix: "logs/",
      bucket: "mock-bucket",
      continuationToken: null,
      nextContinuationToken: null,
    });
  }

  if (!exporterUrl || !token) {
    return json(
      { ok: false, error: "Exporter is not configured. Set AGENT_EXPORTER_URL and AGENT_EXPORTER_TOKEN." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (key) {
    return proxyToExporter(`s3-logs/download?key=${encodeURIComponent(key)}`, token, exporterUrl);
  }

  const continuationToken = searchParams.get("continuationToken");
  const limit = searchParams.get("limit");
  const pathParts = ["s3-logs"];

  if (continuationToken) {
    pathParts.push(`continuationToken=${encodeURIComponent(continuationToken)}`);
  }

  if (limit) {
    pathParts.push(`limit=${encodeURIComponent(limit)}`);
  }

  return proxyToExporter(pathParts.join("?"), token, exporterUrl);
}
