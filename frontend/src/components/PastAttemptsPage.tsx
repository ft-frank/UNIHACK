import { useState } from "react";
import type { VideoScoreRecord } from "../lib/scoreHistory";
import { getQuestionResults, type QuestionResult } from "../questions";

interface PastAttemptsPageProps {
  history: VideoScoreRecord[];
  isDarkMode: boolean;
}

export default function PastAttemptsPage({ history, isDarkMode }: PastAttemptsPageProps) {
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);
  const [resultsMap, setResultsMap] = useState<Record<string, QuestionResult[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});

  const handleToggle = async (videoId: string) => {
    if (expandedVideoId === videoId) {
      setExpandedVideoId(null);
      return;
    }

    setExpandedVideoId(videoId);

    if (!resultsMap[videoId]) {
      setLoadingMap((prev) => ({ ...prev, [videoId]: true }));
      try {
        const results = await getQuestionResults(videoId);
        setResultsMap((prev) => ({ ...prev, [videoId]: results }));
      } catch (err) {
        setErrorMap((prev) => ({
          ...prev,
          [videoId]: err instanceof Error ? err.message : "Failed to load log",
        }));
      } finally {
        setLoadingMap((prev) => ({ ...prev, [videoId]: false }));
      }
    }
  };

  if (history.length === 0) {
    return (
      <div className={`flex aspect-video items-center justify-center rounded-[24px] border p-8 text-center shadow-sm backdrop-blur ${isDarkMode ? "border-slate-800 bg-slate-900/75 text-slate-400" : "border-slate-200 bg-white/80 text-slate-500"}`}>
        <p className={`font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
          No past video attempts found. Complete a video to see your detailed logs here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-up mb-8">
        <h2 className={`text-2xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>Echolearn Attempts Log</h2>
        <p className={`mt-2 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
          Review your previous videos and detailed question performance to see where you can improve.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {history.map((record) => {
          const isExpanded = expandedVideoId === record.videoId;
          const isLoading = loadingMap[record.videoId];
          const hasError = errorMap[record.videoId];
          const logs = resultsMap[record.videoId] || [];

          return (
            <div
              key={`${record.videoId}-${record.completedAt}`}
              className={`animate-fade-up overflow-hidden rounded-2xl border shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
                isDarkMode
                  ? "border-slate-800 bg-slate-900/85 hover:border-slate-700"
                  : "border-slate-200 bg-white/90 hover:border-slate-300"
              }`}
            >
              <button
                onClick={() => handleToggle(record.videoId)}
                className={`flex w-full flex-col items-start gap-4 p-4 text-left transition-all duration-300 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${
                  isDarkMode ? "hover:bg-slate-800/70" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex w-full items-start gap-4 sm:w-auto sm:items-center sm:gap-5">
                  <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-black sm:w-36">
                    <img
                      src={`https://img.youtube.com/vi/${record.videoId}/hqdefault.jpg`}
                      alt={record.videoName}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={`line-clamp-1 text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
                      {record.videoName}
                    </h3>
                    <p className={`mt-1 text-sm font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                      Score: {record.score} / {record.totalQuestions}
                    </p>
                    <p className={`text-xs ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                      Completed: {new Date(record.completedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className={`flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full transition-transform sm:self-auto ${isDarkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className={`h-5 w-5 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className={`border-t p-6 ${isDarkMode ? "border-slate-800 bg-slate-950/40" : "border-slate-100 bg-slate-50/50"}`}>
                  {isLoading ? (
                    <div className={`flex items-center justify-center py-6 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                      <span className="text-sm font-medium">Loading question log...</span>
                    </div>
                  ) : hasError ? (
                    <div className={`rounded-xl border p-4 text-center ${isDarkMode ? "border-rose-900 bg-rose-950/50 text-rose-300" : "border-rose-100 bg-rose-50 text-rose-600"}`}>
                      {hasError}
                    </div>
                  ) : logs.length === 0 ? (
                    <div className={`text-center text-sm font-medium ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                      No detailed log found for this video.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <h4 className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                        Detailed Question Log
                      </h4>
                      {logs.map((log, idx) => (
                        <div
                          key={idx}
                          className={`rounded-xl border p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${isDarkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-3">
                              <span className={`font-mono text-sm font-bold ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                                {formatTime(log.timestamp)}
                              </span>
                              <span
                                className={`rounded bg-opacity-10 px-2 py-0.5 text-xs font-bold uppercase ${
                                  log.correct
                                    ? "bg-emerald-500 text-emerald-600"
                                    : "bg-rose-500 text-rose-600"
                                }`}
                              >
                                {log.correct ? "Correct" : "Incorrect"}
                              </span>
                            </div>
                            <div className="space-y-1">
                              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                                Question asked
                              </p>
                              <p className={`text-sm font-medium ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
                                {log.questionText ?? "Not available"}
                              </p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className={`rounded-lg border px-3 py-2 ${isDarkMode ? "border-slate-700 bg-slate-800/80" : "border-slate-200 bg-slate-50"}`}>
                                <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                                  Your answer
                                </p>
                                <p className={`mt-1 text-sm font-medium ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                                  {log.selectedAnswer ?? "Not available"}
                                </p>
                              </div>
                              <div className={`rounded-lg border px-3 py-2 ${isDarkMode ? "border-emerald-900/70 bg-emerald-950/30" : "border-emerald-200 bg-emerald-50"}`}>
                                <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                                  Correct answer
                                </p>
                                <p className={`mt-1 text-sm font-medium ${isDarkMode ? "text-emerald-100" : "text-emerald-800"}`}>
                                  {log.correctAnswer ?? "Not available"}
                                </p>
                              </div>
                            </div>
                            {log.word && (
                              <p className={`text-sm font-medium ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                                Tested Word: <span className="font-bold">{log.word}</span>
                              </p>
                            )}
                            {log.phoneticCategory && (
                              <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                                Phonetic Category: {log.phoneticCategory}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
