import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { VideoScoreRecord } from "../lib/scoreHistory";

type UserProgress = {
  userId: string;
  totalQuestions: number;
  correctAnswers: number;
  phoneticErrors: Record<string, number>;
  wordErrors: Record<string, number>;
  proficiencyLevel: string;
  lastUpdated: string;
};

type StatisticsPageProps = {
  history: VideoScoreRecord[];
  onClearHistory: () => void;
  onRefresh: () => void;
  isLoading: boolean;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const formatDateTime = (value: string) => {
  const d = new Date(value);
  const base = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(d);
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${base}.${ms}`;
};

const formatCategory = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const proficiencyMeta: Record<string, { bg: string; text: string; bar: string }> = {
  Beginner:     { bg: "#EEF4FF", text: "#3A6EAE", bar: "#3A6EAE" },
  Intermediate: { bg: "#FFFBEB", text: "#B45309", bar: "#F59E0B" },
  Advanced:     { bg: "#F0FFF6", text: "#2D6A4F", bar: "#2D6A4F" },
};

export default function StatisticsPage({ history, onClearHistory, onRefresh, isLoading }: StatisticsPageProps) {
  const [userProgress, setUserProgress] = useState<UserProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);

  useEffect(() => {
    apiFetch<UserProgress>("/progress")
      .then(setUserProgress)
      .catch(() => {})
      .finally(() => setProgressLoading(false));
  }, []);

  const level = userProgress?.proficiencyLevel ?? "Beginner";
  const levelStyle = proficiencyMeta[level] ?? proficiencyMeta.Beginner;

  const topPhoneticErrors = Object.entries(userProgress?.phoneticErrors ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  const maxPhoneticError = Math.max(...topPhoneticErrors.map(([, v]) => v), 1);

  const topWordErrors = Object.entries(userProgress?.wordErrors ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  const hasPhoneticData = topPhoneticErrors.length > 0;
  const hasWordData = topWordErrors.length > 0;
  const hasProgressData = !progressLoading && userProgress !== null;

  // --- Derived stats from history ---
  const totalSessions = history.length;
  const totalQuestionsAnswered = history.reduce((sum, r) => sum + r.totalQuestions, 0);
  const totalCorrect = history.reduce((sum, r) => sum + r.score, 0);
  const overallAccuracy =
    totalQuestionsAnswered > 0
      ? Math.round((totalCorrect / totalQuestionsAnswered) * 100)
      : 0;
  const bestSession = history.reduce<VideoScoreRecord | null>(
    (best, r) => (!best || r.percentage > best.percentage ? r : best),
    null
  );

  // Sessions oldest-first for the trend chart
  const chronological = [...history].reverse();

  // Group by videoId
  const byVideo = new Map<string, VideoScoreRecord[]>();
  for (const record of history) {
    const existing = byVideo.get(record.videoId) ?? [];
    byVideo.set(record.videoId, [...existing, record]);
  }
  const videoGroups = Array.from(byVideo.entries()).map(([videoId, records]) => ({
    videoId,
    videoName: records[0].videoName,
    attempts: records.length,
    best: Math.max(...records.map((r) => r.percentage)),
    latest: records[0],
    all: [...records].reverse(),
  }));
  videoGroups.sort((a, b) => b.best - a.best);

  if (isLoading && history.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#E2E0DB] border-t-[#3A6EAE]" />
          <p className="mt-3 text-sm text-[#7A7570]">Loading your stats…</p>
        </div>
      </div>
    );
  }

  if (!isLoading && history.length === 0 && !progressLoading && !userProgress?.totalQuestions) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="font-semibold text-[#1C1B18]">No data yet</p>
          <p className="mt-1 text-sm text-[#7A7570]">
            Complete a video from the dashboard to start tracking your performance.
          </p>
          <button
            onClick={onRefresh}
            className="mt-4 rounded-lg border border-[#E2E0DB] px-4 py-2 text-sm font-medium text-[#7A7570] transition-colors hover:border-[#D4D2CC] hover:bg-[#F4F6FA]"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-[#1C1B18]">Statistics</h1>
            {progressLoading ? (
              <div className="h-6 w-24 animate-pulse rounded-full bg-[#E2E0DB]" />
            ) : hasProgressData ? (
              <span
                className="rounded-full px-3 py-0.5 text-xs font-semibold"
                style={{ background: levelStyle.bg, color: levelStyle.text }}
              >
                {level}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-[#7A7570]">
            {totalSessions} session{totalSessions !== 1 ? "s" : ""} across{" "}
            {byVideo.size} video{byVideo.size !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="rounded-lg border border-[#E2E0DB] px-3 py-2 text-sm font-medium text-[#7A7570] transition-colors hover:border-[#D4D2CC] hover:bg-[#F4F6FA] disabled:opacity-40"
          >
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={onClearHistory}
            className="rounded-lg border border-[#E2E0DB] px-4 py-2 text-sm font-medium text-[#C13030] transition-colors hover:border-[#C13030]/30 hover:bg-[#FFF0F0]"
          >
            Clear history
          </button>
        </div>
      </div>

      {/* Summary row */}
      {history.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="Sessions" value={`${totalSessions}`} />
          <SummaryCard label="Questions answered" value={`${totalQuestionsAnswered}`} />
          <SummaryCard label="Overall accuracy" value={`${overallAccuracy}%`} />
          <SummaryCard
            label="Best score"
            value={bestSession ? `${bestSession.percentage}%` : "—"}
            sub={bestSession ? bestSession.videoName : undefined}
          />
        </div>
      )}

      {/* Lifetime progress from Supabase user_progress */}
      {(progressLoading || hasProgressData) && (
        <div className="rounded-2xl border border-[#E2E0DB] bg-white p-6 shadow-sm">
          <h2 className="font-bold text-[#1C1B18]">Learning Profile</h2>
          <p className="mt-0.5 text-sm text-[#7A7570]">
            Cumulative progress tracked across all sessions
          </p>

          {progressLoading ? (
            <div className="mt-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-5 w-full animate-pulse rounded bg-[#F4F6FA]" />
              ))}
            </div>
          ) : (
            <>
              {/* Lifetime stat pills */}
              <div className="mt-5 flex flex-wrap gap-3">
                <StatPill
                  label="All-time questions"
                  value={`${userProgress!.totalQuestions}`}
                />
                <StatPill
                  label="All-time correct"
                  value={`${userProgress!.correctAnswers}`}
                />
                {userProgress!.totalQuestions > 0 && (
                  <StatPill
                    label="All-time accuracy"
                    value={`${Math.round((userProgress!.correctAnswers / userProgress!.totalQuestions) * 100)}%`}
                  />
                )}
                <StatPill
                  label="Proficiency"
                  value={level}
                  valueStyle={{ color: levelStyle.text }}
                />
              </div>

              {/* Phonetic errors */}
              {hasPhoneticData && (
                <div className="mt-6">
                  <p className="text-sm font-medium text-[#1C1B18]">Phonetic Weak Spots</p>
                  <p className="mt-0.5 text-xs text-[#7A7570]">
                    Categories with the most errors — focus here to improve
                  </p>
                  <div className="mt-3 space-y-2">
                    {topPhoneticErrors.map(([category, count]) => (
                      <div key={category} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 truncate text-xs text-[#7A7570]">
                          {formatCategory(category)}
                        </span>
                        <div className="flex-1 rounded-full bg-[#F4F6FA]">
                          <div
                            className="h-2 rounded-full bg-[#C13030]/70 transition-all"
                            style={{ width: `${(count / maxPhoneticError) * 100}%` }}
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right text-xs font-medium text-[#1C1B18]">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Word errors */}
              {hasWordData && (
                <div className="mt-6">
                  <p className="text-sm font-medium text-[#1C1B18]">Frequently Missed Words</p>
                  <p className="mt-0.5 text-xs text-[#7A7570]">
                    Words that appeared most often in incorrect answers
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {topWordErrors.map(([word, count]) => (
                      <span
                        key={word}
                        className="flex items-center gap-1.5 rounded-full border border-[#E2E0DB] bg-[#F4F6FA] px-3 py-1 text-xs"
                      >
                        <span className="font-medium text-[#1C1B18]">{word}</span>
                        <span className="text-[#B8B5AF]">×{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!hasPhoneticData && !hasWordData && (
                <p className="mt-4 text-sm text-[#B8B5AF]">
                  Complete more sessions to see detailed error patterns.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Score trend chart */}
      {chronological.length >= 2 && (
        <div className="rounded-2xl border border-[#E2E0DB] bg-white p-6 shadow-sm">
          <h2 className="font-bold text-[#1C1B18]">Score over time</h2>
          <p className="mt-0.5 text-sm text-[#7A7570]">
            Each bar is one completed session, oldest to newest
          </p>
          <div className="mt-6 flex h-48 items-end gap-2">
            {chronological.map((record) => {
              const pct = Math.max(record.percentage, 4);
              const isGood = record.percentage >= 70;
              return (
                <div
                  key={record.id}
                  className="group relative flex flex-1 flex-col items-center gap-1.5"
                >
                  <div className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[#E2E0DB] bg-white px-2.5 py-1.5 text-xs opacity-0 shadow-sm transition-opacity group-hover:opacity-100 z-10">
                    <p className="font-semibold text-[#1C1B18]">{record.percentage}%</p>
                    <p className="text-[#7A7570]">{record.videoName}</p>
                    <p className="text-[#B8B5AF]">{formatDate(record.completedAt)}</p>
                  </div>
                  <div className="flex h-full w-full items-end">
                    <div
                      className={`w-full rounded-t-md transition-all ${
                        isGood ? "bg-[#2D6A4F]" : "bg-[#3A6EAE]"
                      }`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="hidden text-center text-[10px] text-[#B8B5AF] lg:block">
                    {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
                      new Date(record.completedAt)
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-[#7A7570]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2D6A4F]" />
              ≥ 70%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#3A6EAE]" />
              &lt; 70%
            </span>
          </div>
        </div>
      )}

      {/* Per-video breakdown */}
      {videoGroups.length > 0 && (
        <div className="rounded-2xl border border-[#E2E0DB] bg-white p-6 shadow-sm">
          <h2 className="font-bold text-[#1C1B18]">By video</h2>
          <p className="mt-0.5 text-sm text-[#7A7570]">
            Best score and attempts for each video
          </p>
          <div className="mt-5 divide-y divide-[#E2E0DB]">
            {videoGroups.map((group) => (
              <div key={group.videoId} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#1C1B18]">{group.videoName}</p>
                    <p className="mt-0.5 text-xs text-[#7A7570]">
                      {group.attempts} {group.attempts === 1 ? "attempt" : "attempts"} · last{" "}
                      {formatDateTime(group.latest.completedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {group.all.length > 1 && (
                      <div className="hidden items-center gap-1 sm:flex">
                        {group.all.map((r) => (
                          <div
                            key={r.id}
                            title={`${r.percentage}%`}
                            className={`h-2 w-2 rounded-full ${
                              r.percentage >= 70 ? "bg-[#2D6A4F]" : "bg-[#3A6EAE]"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                    <span
                      className={`rounded-md px-2.5 py-1 text-sm font-semibold ${
                        group.best >= 70
                          ? "bg-[#F0FFF6] text-[#2D6A4F]"
                          : "bg-[#EEF4FF] text-[#3A6EAE]"
                      }`}
                    >
                      {group.best}%
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-[#F4F6FA]">
                  <div
                    className={`h-1 rounded-full transition-all ${
                      group.best >= 70 ? "bg-[#2D6A4F]" : "bg-[#3A6EAE]"
                    }`}
                    style={{ width: `${group.best}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full session log */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-[#E2E0DB] bg-white p-6 shadow-sm">
          <h2 className="font-bold text-[#1C1B18]">Session log</h2>
          <p className="mt-0.5 text-sm text-[#7A7570]">Every completed session, newest first</p>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E2E0DB]">
                  <th className="pb-3 pr-6 text-xs font-medium text-[#7A7570]">Video</th>
                  <th className="pb-3 pr-6 text-xs font-medium text-[#7A7570]">Date</th>
                  <th className="pb-3 pr-6 text-xs font-medium text-[#7A7570]">Correct</th>
                  <th className="pb-3 text-xs font-medium text-[#7A7570]">Score</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => (
                  <tr key={record.id} className="border-b border-[#E2E0DB]/60 align-middle">
                    <td className="py-3 pr-6 font-medium text-[#1C1B18] max-w-[240px] truncate">
                      {record.videoName}
                    </td>
                    <td className="py-3 pr-6 text-[#7A7570] whitespace-nowrap">
                      {formatDateTime(record.completedAt)}
                    </td>
                    <td className="py-3 pr-6 text-[#7A7570]">
                      {record.score}/{record.totalQuestions}
                    </td>
                    <td className="py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                          record.percentage >= 70
                            ? "bg-[#F0FFF6] text-[#2D6A4F]"
                            : "bg-[#EEF4FF] text-[#3A6EAE]"
                        }`}
                      >
                        {record.percentage}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#E2E0DB] bg-white p-5 shadow-sm">
      <p className="text-xs text-[#7A7570]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-[#1C1B18]">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-[#B8B5AF]">{sub}</p>}
    </div>
  );
}

function StatPill({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="rounded-xl border border-[#E2E0DB] bg-[#F4F6FA] px-4 py-2.5">
      <p className="text-xs text-[#7A7570]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[#1C1B18]" style={valueStyle}>
        {value}
      </p>
    </div>
  );
}
