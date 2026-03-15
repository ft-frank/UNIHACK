// questions.ts
import type { UserSettings } from "./components/settings";
import { apiFetch } from "./lib/api";

type BaseQuestion = {
  timestamp: number;
  question: string;
  word?: string;
  phoneticCategory?: string;
};

export type MultipleChoiceQuestion = BaseQuestion & {
  kind: "multiple-choice";
  choices: string[];
  answerIndex: number;
};

export type FillInTheBlanksQuestion = BaseQuestion & {
  kind: "fill-in-the-blanks";
  sentenceWithBlanks: string;
  promptSentence: string;
  blanks: string[];
};

export type Question = MultipleChoiceQuestion | FillInTheBlanksQuestion;

export type QuestionsJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  questions: Question[] | null;
  error: string | null;
  mediaId?: string;
  title?: string;
};

export type QuestionResult = {
  videoId: string;
  timestamp: number;
  correct: boolean;
  questionText?: string;
  selectedAnswer?: string;
  correctAnswer?: string;
  word?: string;
  phoneticCategory?: string;
};

export const createQuestionsJob = async (
  youtubeUrl: string,
  settings: UserSettings
): Promise<string> => {
  const data = await apiFetch<{ jobId: string }>("/questions/jobs", {
    method: "POST",
    body: JSON.stringify({ url: youtubeUrl, ...settings }),
  });
  return data.jobId;
};

export const createUploadQuestionsJob = async (
  file: File,
  settings: UserSettings
): Promise<{ jobId: string; mediaId: string; title: string }> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", settings.type);
  formData.append("difficulty", settings.difficulty);
  formData.append("frequency", settings.frequency);
  formData.append("cochlearAssessmentMode", settings.cochlearAssessmentMode);
  formData.append("specificGroups", settings.specificGroups);
  formData.append("specificSounds", settings.specificSounds);

  return apiFetch<{ jobId: string; mediaId: string; title: string }>(
    "/questions/jobs/upload",
    { method: "POST", body: formData }
  );
};

export const getQuestionsJob = async (jobId: string): Promise<QuestionsJob> => {
  const job = await apiFetch<QuestionsJob>(`/questions/jobs/${jobId}`);
  if (job.questions) {
    console.log("Questions fetched:", job.questions);
  }
  return job;
};

export const submitQuestionResult = async (
  videoId: string,
  timestamp: number,
  correct: boolean,
  questionText?: string,
  selectedAnswer?: string,
  correctAnswer?: string,
  word?: string,
  phoneticCategory?: string
): Promise<void> => {
  await apiFetch<{ status: string }>("/questions/results", {
    method: "POST",
    body: JSON.stringify({
      videoId,
      timestamp,
      correct,
      questionText,
      selectedAnswer,
      correctAnswer,
      word,
      phoneticCategory,
    }),
  });
};

export const getQuestionResults = async (
  videoId: string
): Promise<QuestionResult[]> =>
  apiFetch<QuestionResult[]>(`/questions/results/${videoId}`);
