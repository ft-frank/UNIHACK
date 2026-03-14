import { apiFetch, backendHasPath } from "./api";

export type VideoScoreRecord = {
  id: string;
  videoId: string;
  videoName: string;
  completedAt: string;
  score: number;
  totalQuestions: number;
  percentage: number;
};

const normalizeScoreRecord = (record: VideoScoreRecord): VideoScoreRecord => ({
  ...record,
  id: record.id ?? `${record.videoId}-${record.completedAt}`,
  percentage:
    record.percentage ??
    (record.totalQuestions > 0
      ? Math.round((record.score / record.totalQuestions) * 100)
      : 0),
});

const tryHistoryRequest = async <T>(
  method: "GET" | "POST" | "DELETE",
  body?: string
): Promise<T> => {
  const hasHistoryPath = await backendHasPath("/history");
  if (!hasHistoryPath) {
    if (method === "GET") return [] as T;
    return { status: "unavailable" } as T;
  }

  try {
    return await apiFetch<T>("/history", {
      method,
      ...(body ? { body } : {}),
    });
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      if (method === "GET") return [] as T;
      return { status: "unavailable" } as T;
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "Not Found") {
      if (method === "GET") return [] as T;
      return { status: "unavailable" } as T;
    }
    throw error;
  }
};

export const getStoredHistory = async (): Promise<VideoScoreRecord[]> => {
  const records = await tryHistoryRequest<VideoScoreRecord[]>("GET");
  return records.map(normalizeScoreRecord);
};

export const saveScoreRecord = async (
  record: Omit<VideoScoreRecord, "id" | "percentage" | "completedAt"> & {
    completedAt?: string;
  }
): Promise<VideoScoreRecord[]> => {
  const completedAt = record.completedAt ?? new Date().toISOString();
  const percentage =
    record.totalQuestions > 0
      ? Math.round((record.score / record.totalQuestions) * 100)
      : 0;

  const payload = JSON.stringify({
    id: `${record.videoId}-${Date.now()}`,
    videoId: record.videoId,
    videoName: record.videoName,
    completedAt,
    score: record.score,
    totalQuestions: record.totalQuestions,
    percentage,
  });

  const records = await tryHistoryRequest<VideoScoreRecord[]>("POST", payload);
  return records.map(normalizeScoreRecord);
};

export const clearStoredHistory = async () => {
  await tryHistoryRequest<{ status: string }>("DELETE");
};
