export type VideoScoreRecord = {
  id: string;
  videoId: string;
  videoName: string;
  completedAt: string;
  score: number;
  totalQuestions: number;
  percentage: number;
};

const STORAGE_KEY = "unihack.videoScoreHistory";

const hasWindow = () => typeof window !== "undefined";

export const getStoredHistory = (): VideoScoreRecord[] => {
  if (!hasWindow()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as VideoScoreRecord[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry.videoId === "string" &&
          typeof entry.videoName === "string" &&
          typeof entry.completedAt === "string" &&
          typeof entry.score === "number" &&
          typeof entry.totalQuestions === "number" &&
          typeof entry.percentage === "number"
      )
      .sort(
        (a, b) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
      );
  } catch {
    return [];
  }
};

export const saveScoreRecord = (
  record: Omit<VideoScoreRecord, "id" | "percentage" | "completedAt"> & {
    completedAt?: string;
  }
): VideoScoreRecord[] => {
  const completedAt = record.completedAt ?? new Date().toISOString();
  const percentage =
    record.totalQuestions > 0
      ? Math.round((record.score / record.totalQuestions) * 100)
      : 0;

  const nextEntry: VideoScoreRecord = {
    id: `${record.videoId}-${Date.now()}`,
    videoId: record.videoId,
    videoName: record.videoName,
    completedAt,
    score: record.score,
    totalQuestions: record.totalQuestions,
    percentage,
  };

  const nextHistory = [nextEntry, ...getStoredHistory()];

  if (hasWindow()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  }

  return nextHistory;
};

export const clearStoredHistory = () => {
  if (!hasWindow()) return;
  window.localStorage.removeItem(STORAGE_KEY);
};
