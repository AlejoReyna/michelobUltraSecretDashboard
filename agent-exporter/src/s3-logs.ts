import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { safeError } from "./redact.js";

export type S3LogObject = {
  key: string;
  sizeBytes: number;
  lastModified: string;
};

export type S3LogsListResult = {
  ok: boolean;
  objects: S3LogObject[];
  prefix: string;
  bucket: string;
  continuationToken: string | null;
  nextContinuationToken: string | null;
  error?: string;
};

export type S3LogsDownloadResult = {
  ok: boolean;
  url: string | null;
  key: string;
  bucket: string;
  error?: string;
};

export type S3LogsConfig = {
  bucket: string | undefined;
  prefix: string;
  region: string;
};

export function loadS3LogsConfig(env: NodeJS.ProcessEnv = process.env): S3LogsConfig {
  return {
    bucket: env.S3_LOGS_BUCKET,
    prefix: env.S3_LOGS_PREFIX ?? "logs/",
    region: env.S3_LOGS_REGION ?? env.AWS_REGION ?? "us-east-1",
  };
}

function createS3Client(region: string): S3Client {
  return new S3Client({ region });
}

function normalizePrefix(prefix: string): string {
  if (!prefix) {
    return "";
  }

  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export async function listS3Logs(
  config: S3LogsConfig,
  continuationToken?: string,
  maxKeys = 1000,
): Promise<S3LogsListResult> {
  if (!config.bucket) {
    return {
      ok: false,
      objects: [],
      prefix: config.prefix,
      bucket: "",
      continuationToken: continuationToken ?? null,
      nextContinuationToken: null,
      error: "S3_LOGS_BUCKET is not configured",
    };
  }

  const client = createS3Client(config.region);
  const prefix = normalizePrefix(config.prefix);

  try {
    const command = new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: Math.min(Math.max(maxKeys, 1), 1000),
    });

    const response = await client.send(command);

    return {
      ok: true,
      objects: (response.Contents ?? []).map((object) => ({
        key: object.Key ?? "",
        sizeBytes: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? "",
      })),
      prefix,
      bucket: config.bucket,
      continuationToken: continuationToken ?? null,
      nextContinuationToken: response.NextContinuationToken ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      objects: [],
      prefix,
      bucket: config.bucket,
      continuationToken: continuationToken ?? null,
      nextContinuationToken: null,
      error: safeError(error),
    };
  }
}

export async function getS3LogsDownloadUrl(config: S3LogsConfig, key: string): Promise<S3LogsDownloadResult> {
  if (!config.bucket) {
    return {
      ok: false,
      url: null,
      key,
      bucket: "",
      error: "S3_LOGS_BUCKET is not configured",
    };
  }

  if (!key) {
    return {
      ok: false,
      url: null,
      key,
      bucket: config.bucket,
      error: "Missing object key",
    };
  }

  // Prevent path-traversal: key must stay within the configured prefix
  if (!key.startsWith(config.prefix)) {
    return {
      ok: false,
      url: null,
      key,
      bucket: config.bucket,
      error: `Key is outside the allowed prefix (${config.prefix})`,
    };
  }

  const client = createS3Client(config.region);

  try {
    const command = new GetObjectCommand({ Bucket: config.bucket, Key: key });
    const url = await getSignedUrl(client, command, { expiresIn: 300 });

    return {
      ok: true,
      url,
      key,
      bucket: config.bucket,
    };
  } catch (error) {
    return {
      ok: false,
      url: null,
      key,
      bucket: config.bucket,
      error: safeError(error),
    };
  }
}
