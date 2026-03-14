// questions.ts
import type { UserSettings } from "./components/settings";

export type Question = {
  timestamp: number;
  question: string;
  choices: string[];
  answerIndex: number;
};

export type QuestionsJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  questions: Question[] | null;
  error: string | null;
};

const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const createQuestionsJob = async (
  youtubeUrl: string,
  settings: UserSettings
): Promise<string> => {
  const response = await fetch(`${apiBase}/questions/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: youtubeUrl,
      ...settings,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Failed to fetch questions");
  }

  const data: { jobId: string } = await response.json();
  return data.jobId;
};

export const getQuestionsJob = async (jobId: string): Promise<QuestionsJob> => {
  const response = await fetch(`${apiBase}/questions/jobs/${jobId}`);

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Failed to load job status");
  }
  const data = await response.json();
  console.log(data);
  return data;
};
