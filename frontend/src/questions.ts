// questions.ts
import type { UserSettings } from "./components/settings";

export type Question = {
  timestamp: number;
  question: string;
  choices: string[];
  answerIndex: number;
};

export const fetchQuestionsForVideo = async (
  youtubeUrl: string, 
  settings: UserSettings
): Promise<Question[]> => {
  const response = await fetch("http://localhost:8000/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // We spread the settings object here so the backend gets everything
    body: JSON.stringify({ 
      url: youtubeUrl, 
      ...settings 
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Failed to fetch questions");
  }

  const data: Question[] = await response.json();
  return data;
};