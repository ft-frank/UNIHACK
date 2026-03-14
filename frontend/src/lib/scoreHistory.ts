export type VideoScoreRecord = {
  id: string;
  videoId: string;
  videoName: string;
  completedAt: string;
  score: number;
  totalQuestions: number;
  percentage: number;
};

const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const getStoredHistory = async (): Promise<VideoScoreRecord[]> => {
  const response = await fetch(`${apiBase}/scores`);

  if (!response.ok) {
    throw new Error("Failed to load score history");
  }

  return response.json();
};

export const saveScoreRecord = async (
  record: Omit<VideoScoreRecord, "id" | "percentage" | "completedAt"> & {
    completedAt?: string;
  }
): Promise<VideoScoreRecord> => {
  const response = await fetch(`${apiBase}/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...record,
      completedAt: record.completedAt ?? new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to save score history");
  }

  return response.json();
};

export const clearStoredHistory = async () => {
  const response = await fetch(`${apiBase}/scores`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to clear score history");
  }
};
