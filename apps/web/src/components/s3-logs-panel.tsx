"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, AlertCircle, ChevronLeft, ChevronRight, FileText } from "lucide-react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDate(iso: string): string {
  if (!iso) {
    return "—";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function basename(key: string): string {
  const parts = key.split("/");
  return parts.at(-1) || key;
}

type S3LogObject = {
  key: string;
  sizeBytes: number;
  lastModified: string;
};

type S3LogsResponse = {
  ok: boolean;
  objects: S3LogObject[];
  prefix: string;
  bucket: string;
  continuationToken: string | null;
  nextContinuationToken: string | null;
  error?: string;
};

type DownloadResponse = {
  ok: boolean;
  url: string | null;
  key: string;
  error?: string;
};

export default function S3LogsPanel({ compact = false, desktop = false }: { compact?: boolean; desktop?: boolean }) {
  const [objects, setObjects] = useState<S3LogObject[]>([]);
  const [nextContinuationToken, setNextContinuationToken] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string>("");
  const [prefix, setPrefix] = useState<string>("");

  const fetchLogs = useCallback(async (token: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (token) {
        params.set("continuationToken", token);
      }
      params.set("limit", "50");

      const response = await fetch(`/api/s3-logs?${params.toString()}`, {
        cache: "no-store",
      });

      const data = (await response.json()) as S3LogsResponse;

      if (!response.ok || !data.ok) {
        setError(data.error || `Failed to load logs (${response.status})`);
        setObjects([]);
        return;
      }

      setObjects(data.objects);
      setNextContinuationToken(data.nextContinuationToken);
      setBucket(data.bucket);
      setPrefix(data.prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setObjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchLogs(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fetchLogs]);

  const handleNext = () => {
    if (!nextContinuationToken) {
      return;
    }

    const nextPage = page + 1;
    setHistory((prev) => {
      const copy = [...prev];
      copy[nextPage] = nextContinuationToken;
      return copy;
    });
    setPage(nextPage);
    fetchLogs(nextContinuationToken);
  };

  const handlePrev = () => {
    if (page <= 0) {
      return;
    }

    const prevPage = page - 1;
    const prevToken = history[prevPage] ?? null;
    setPage(prevPage);
    fetchLogs(prevToken);
  };

  const handleDownload = async (key: string) => {
    try {
      const response = await fetch(`/api/s3-logs?key=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as DownloadResponse;

      if (!response.ok || !data.ok || !data.url) {
        alert(data.error || "Could not generate download link");
        return;
      }

      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const empty = !loading && objects.length === 0;

  return (
    <section
      className={cx(
        "flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0B0E11]",
        desktop ? "px-8 pt-6" : "px-5 pt-6 sm:px-8",
      )}
    >
      <div className="shrink-0 border-b border-[#2B2F36] pb-4">
        <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">Storage</div>
        <div className="mt-1 flex items-center justify-between">
          <h2 className="font-sans text-[16px] font-semibold text-white">S3 Logs</h2>
          {bucket ? (
            <span className="font-sans text-[10px] uppercase tracking-[0.1em] text-[#848E9C]">
              {bucket}/{prefix}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-[#F6465D]/30 bg-[#F6465D]/10 px-4 py-3 font-sans text-[12px] text-[#F6465D]">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-bold">Could not load S3 logs</div>
            <div className="mt-0.5 text-[#B0B3B8]">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="console-scroll min-h-0 flex-1 overflow-y-auto py-4">
        {loading && objects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[#848E9C]">
            <Loader2 size={24} className="animate-spin" />
            <span className="font-sans text-[12px]">Loading logs…</span>
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[#848E9C]">
            <FileText size={24} />
            <span className="font-sans text-[12px]">No log objects found in S3.</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#2B2F36]">
            <table className="w-full text-left font-sans text-[12px]">
              <thead>
                <tr className="border-b border-[#2B2F36] bg-[#1E2026] text-[#848E9C] uppercase tracking-widest text-[10px]">
                  <th className={cx("py-3 font-bold", compact ? "px-3" : "px-4")}>Object</th>
                  {!compact ? <th className="px-4 py-3 font-bold">Size</th> : null}
                  {!compact ? <th className="px-4 py-3 font-bold">Modified</th> : null}
                  <th className={cx("py-3 font-bold text-right", compact ? "px-3" : "px-4")}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2B2F36]">
                {objects.map((object) => (
                  <tr
                    key={object.key}
                    className="transition-colors hover:bg-[#1E2026]/60"
                  >
                    <td className={cx("py-3", compact ? "px-3" : "px-4")}>
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="shrink-0 text-[#848E9C]" />
                        <span
                          className="truncate font-medium text-white"
                          title={object.key}
                        >
                          {compact ? basename(object.key) : object.key}
                        </span>
                      </div>
                    </td>
                    {!compact ? (
                      <td className="px-4 py-3 tabular-nums text-[#B0B3B8]">
                        {formatBytes(object.sizeBytes)}
                      </td>
                    ) : null}
                    {!compact ? (
                      <td className="px-4 py-3 tabular-nums text-[#B0B3B8]">
                        {formatDate(object.lastModified)}
                      </td>
                    ) : null}
                    <td className={cx("py-3 text-right", compact ? "px-3" : "px-4")}>
                      <button
                        type="button"
                        onClick={() => handleDownload(object.key)}
                        className="inline-flex items-center gap-1.5 rounded border border-[#3A3F4B] bg-[#1E2026] px-2.5 py-1 font-sans text-[10px] font-bold uppercase tracking-wider text-[#B0B3B8] transition-colors hover:border-[#4A4F5B] hover:text-white"
                      >
                        {compact ? <Download size={12} /> : <><Download size={12} /> Download</>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[#2B2F36] py-3 font-sans text-[10px] uppercase tracking-widest text-[#848E9C]">
        <button
          type="button"
          onClick={handlePrev}
          disabled={page === 0 || loading}
          className={cx(
            "inline-flex items-center gap-1 transition-colors",
            page === 0 || loading ? "cursor-not-allowed text-[#4A4F5B]" : "text-[#B0B3B8] hover:text-white",
          )}
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="tabular-nums">Page {page + 1}</span>
        <button
          type="button"
          onClick={handleNext}
          disabled={!nextContinuationToken || loading}
          className={cx(
            "inline-flex items-center gap-1 transition-colors",
            !nextContinuationToken || loading ? "cursor-not-allowed text-[#4A4F5B]" : "text-[#B0B3B8] hover:text-white",
          )}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </section>
  );
}
