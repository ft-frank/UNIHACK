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
      <div className="flex aspect-video items-center justify-center rounded-2xl border-2 border-dashed border-[#D4D2CC] bg-[#F7F6F2] p-8 text-center">
        <div>
          <p className="font-medium text-[#1C1B18]">No past attempts yet</p>
          <p className="mt-1 text-sm text-[#7A7570]">
            Complete a video to see your detailed question logs here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="font-semibold text-[#1C1B18]">Past Attempts</h2>
        <p className="mt-1 text-sm text-[#7A7570]">
          Review your previous videos and question-level performance.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {history.map((record) => {
          const isExpanded = expandedVideoId === record.videoId;
          const isLoading = loadingMap[record.videoId];
          const hasError = errorMap[record.videoId];
          const logs = resultsMap[record.videoId] || [];

          return (
            <div
              key={`${record.videoId}-${record.completedAt}`}
              className="overflow-hidden rounded-2xl border border-[#E2E0DB] bg-white shadow-sm"
            >
              <button
                onClick={() => handleToggle(record.videoId)}
                className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-[#F7F6F2]"
              >
                <div className="flex items-center gap-4">
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-[#1C1B18]">
                    <img
                      src={`https://img.youtube.com/vi/${record.videoId}/hqdefault.jpg`}
                      alt={record.videoName}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="font-semibold text-[#1C1B18] line-clamp-1">
                      {record.videoName}
                    </h3>
                    <p className="mt-0.5 text-sm text-[#7A7570]">
                      {record.score} / {record.totalQuestions} correct
                    </p>
                    <p className="text-xs text-[#B8B5AF]">
                      {new Date(record.completedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="rounded-md bg-[#F7F6F2] px-2.5 py-1 text-sm font-semibold text-[#1C1B18]">
                    {record.percentage}%
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E0DB] text-[#7A7570]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className={`h-4 w-4 transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-[#E2E0DB] bg-[#F7F6F2] p-5">
                  {isLoading ? (
                    <p className="py-4 text-center text-sm text-[#B8B5AF]">
                      Loading question log…
                    </p>
                  ) : hasError ? (
                    <div className="rounded-xl border border-[#C13030]/20 bg-[#FFF0F0] p-4 text-center text-sm text-[#C13030]">
                      {hasError}
                    </div>
                  ) : logs.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[#B8B5AF]">
                      No detailed log found for this video.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="mb-2 text-xs font-medium text-[#7A7570]">
                        {logs.length} question{logs.length !== 1 ? "s" : ""}
                      </p>
                      {logs.map((log, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-xl border border-[#E2E0DB] bg-white p-4"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2.5">
                              <span className="text-sm text-[#7A7570]">
                                {formatTime(log.timestamp)}
                              </span>
                              <span
                                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                  log.correct
                                    ? "bg-[#F0FFF6] text-[#2D6A4F]"
                                    : "bg-[#FFF0F0] text-[#C13030]"
                                }`}
                              >
                                {log.correct ? "Correct" : "Incorrect"}
                              </span>
                            </div>
                            {log.word && (
                              <p className="text-sm text-[#7A7570]">
                                Word: <span className="font-semibold text-[#1C1B18]">{log.word}</span>
                              </p>
                            )}
                            {log.phoneticCategory && (
                              <p className="text-xs text-[#B8B5AF]">
                                {log.phoneticCategory}
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
