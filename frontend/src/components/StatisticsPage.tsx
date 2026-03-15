import type { VideoScoreRecord } from "../lib/scoreHistory";

type StatisticsPageProps = {
  history: VideoScoreRecord[];
  onClearHistory: () => void;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function StatisticsPage({ history, onClearHistory }: StatisticsPageProps) {
  if (history.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="font-semibold text-[#1C1B18]">No data yet</p>
          <p className="mt-1 text-sm text-[#7A7570]">
            Complete a video from the dashboard to start tracking your performance.
          </p>
        </div>
      </div>
    );
  }

  // --- Derived stats from localStorage data ---
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

  // Group by videoId to show per-video history
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
    latest: records[0], // history is newest-first
    all: [...records].reverse(), // oldest-first for mini trend
  }));
  videoGroups.sort((a, b) => b.best - a.best);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-bold text-[#1C1B18]">Statistics</h1>
          <p className="mt-0.5 text-sm text-[#7A7570]">
            {totalSessions} session{totalSessions !== 1 ? "s" : ""} across{" "}
            {byVideo.size} video{byVideo.size !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={onClearHistory}
          className="rounded-lg border border-[#E2E0DB] px-4 py-2 text-sm font-medium text-[#C13030] transition-colors hover:border-[#C13030]/30 hover:bg-[#FFF0F0]"
        >
          Clear history
        </button>
      </div>

      {/* Summary row */}
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
                  {/* Tooltip */}
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
                  {/* Mini attempt dots */}
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
              {/* Score bar */}
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

      {/* Full session log */}
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
      {sub && (
        <p className="mt-1 truncate text-xs text-[#B8B5AF]">{sub}</p>
      )}
    </div>
  );
}
