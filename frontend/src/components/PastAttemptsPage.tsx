import { useState } from "react";
import type { VideoScoreRecord } from "../lib/scoreHistory";
import { getQuestionResults, type QuestionResult } from "../questions";

interface PastAttemptsPageProps {
  history: VideoScoreRecord[];
}

export default function PastAttemptsPage({ history }: PastAttemptsPageProps) {
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
      <div className="flex aspect-video items-center justify-center rounded-[24px] border border-slate-200 bg-white/80 p-8 text-center text-slate-500 shadow-sm backdrop-blur">
        <p className="font-medium text-slate-500">
          No past video attempts found. Complete a video to see your detailed logs here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Past Attempts Log</h2>
        <p className="mt-2 text-sm text-slate-500">
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
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm transition-all hover:border-slate-300"
            >
              <button
                onClick={() => handleToggle(record.videoId)}
                className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-5">
                  <div className="relative h-20 w-36 shrink-0 overflow-hidden rounded-xl bg-black">
                    <img
                      src={`https://img.youtube.com/vi/${record.videoId}/hqdefault.jpg`}
                      alt={record.videoName}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-lg font-bold text-slate-800 line-clamp-1">
                      {record.videoName}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      Score: {record.score} / {record.totalQuestions}
                    </p>
                    <p className="text-xs text-slate-400">
                      Completed: {new Date(record.completedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-transform">
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
                <div className="border-t border-slate-100 bg-slate-50/50 p-6">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-6 text-slate-400">
                      <span className="text-sm font-medium">Loading question log...</span>
                    </div>
                  ) : hasError ? (
                    <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-center text-rose-600">
                      {hasError}
                    </div>
                  ) : logs.length === 0 ? (
                    <div className="text-center text-sm font-medium text-slate-400">
                      No detailed log found for this video.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Detailed Question Log
                      </h4>
                      {logs.map((log, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm font-bold text-slate-500">
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
                            {log.word && (
                              <p className="text-sm font-medium text-slate-700">
                                Tested Word: <span className="font-bold">{log.word}</span>
                              </p>
                            )}
                            {log.phoneticCategory && (
                              <p className="text-xs text-slate-500">
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
