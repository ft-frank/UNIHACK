import type { VideoScoreRecord } from "../lib/scoreHistory";

type StatisticsPageProps = {
  history: VideoScoreRecord[];
  onClearHistory: () => void;
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatDay = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));

export default function StatisticsPage({
  history,
  onClearHistory,
}: StatisticsPageProps) {
  const totalSessions = history.length;
  const completedVideos = new Set(history.map((entry) => entry.videoId)).size;
  const averagePercentage = totalSessions
    ? Math.round(
        history.reduce((sum, entry) => sum + entry.percentage, 0) / totalSessions
      )
    : 0;
  const bestRun = history.reduce<VideoScoreRecord | null>(
    (best, entry) => (!best || entry.percentage > best.percentage ? entry : best),
    null
  );
  const recentTrend = [...history].reverse().slice(-7);
  const latestRun = history[0] ?? null;
  const firstRun = history[history.length - 1] ?? null;
  const improvement =
    latestRun && firstRun && history.length > 1
      ? latestRun.percentage - firstRun.percentage
      : 0;

  const leaderboard = Array.from(
    history.reduce((map, entry) => {
      const current = map.get(entry.videoId) ?? {
        videoId: entry.videoId,
        videoName: entry.videoName,
        attempts: 0,
        bestPercentage: 0,
        latestCompletedAt: entry.completedAt,
      };

      current.attempts += 1;
      current.bestPercentage = Math.max(current.bestPercentage, entry.percentage);
      if (
        new Date(entry.completedAt).getTime() >
        new Date(current.latestCompletedAt).getTime()
      ) {
        current.latestCompletedAt = entry.completedAt;
      }

      map.set(entry.videoId, current);
      return map;
    }, new Map<string, {
      videoId: string;
      videoName: string;
      attempts: number;
      bestPercentage: number;
      latestCompletedAt: string;
    }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.bestPercentage - a.bestPercentage || b.attempts - a.attempts);

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
              Statistics
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">
              Track how your quiz performance changes over time
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600">
              Every completed video is saved in a local browser database with its
              name, completion time, and final score.
            </p>
          </div>

          {history.length > 0 && (
            <button
              onClick={onClearHistory}
              className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              Clear history
            </button>
          )}
        </div>
      </section>

      {history.length === 0 ? (
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 p-10 text-center shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">No completed videos yet</h2>
          <p className="mt-3 text-sm text-slate-600">
            Finish a video from the dashboard and your first score record will show
            up here automatically.
          </p>
        </section>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Completed sessions"
              value={`${totalSessions}`}
              detail="Total finished video runs saved locally"
            />
            <StatCard
              label="Unique videos"
              value={`${completedVideos}`}
              detail="Different videos you have completed"
            />
            <StatCard
              label="Average score"
              value={`${averagePercentage}%`}
              detail="Mean performance across all sessions"
            />
            <StatCard
              label="Improvement"
              value={`${improvement >= 0 ? "+" : ""}${improvement}%`}
              detail="Latest run compared with your earliest saved run"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-sm">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Recent trend</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Last {recentTrend.length} completions by score percentage
                </p>
              </div>

              <div className="mt-8 flex h-72 items-end gap-3">
                {recentTrend.map((entry) => (
                  <div key={entry.id} className="flex flex-1 flex-col items-center gap-3">
                    <div className="flex h-full w-full items-end">
                      <div
                        className="w-full rounded-t-2xl bg-gradient-to-t from-sky-600 via-cyan-500 to-emerald-400 px-2 pt-3 text-center text-xs font-bold text-white shadow-[0_16px_32px_rgba(14,116,144,0.28)]"
                        style={{ height: `${Math.max(entry.percentage, 8)}%` }}
                      >
                        {entry.percentage}%
                      </div>
                    </div>
                    <div className="text-center text-xs font-medium text-slate-500">
                      {formatDay(entry.completedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Highlights</h2>
              <div className="mt-6 space-y-4">
                <HighlightCard
                  label="Best run"
                  title={bestRun ? bestRun.videoName : "No data"}
                  value={
                    bestRun
                      ? `${bestRun.score}/${bestRun.totalQuestions} (${bestRun.percentage}%)`
                      : "0%"
                  }
                  detail={
                    bestRun
                      ? formatDateTime(bestRun.completedAt)
                      : "Complete a video to populate this card"
                  }
                />
                <HighlightCard
                  label="Latest run"
                  title={latestRun ? latestRun.videoName : "No data"}
                  value={
                    latestRun
                      ? `${latestRun.score}/${latestRun.totalQuestions} (${latestRun.percentage}%)`
                      : "0%"
                  }
                  detail={
                    latestRun
                      ? formatDateTime(latestRun.completedAt)
                      : "No saved sessions yet"
                  }
                />
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.05fr_1.15fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Video leaderboard</h2>
              <p className="mt-1 text-sm text-slate-600">
                Which videos are giving you the strongest results
              </p>
              <div className="mt-6 space-y-3">
                {leaderboard.slice(0, 6).map((item) => (
                  <div
                    key={item.videoId}
                    className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900">{item.videoName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.attempts} {item.attempts === 1 ? "attempt" : "attempts"} - last played{" "}
                          {formatDateTime(item.latestCompletedAt)}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
                        {item.bestPercentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Completion history</h2>
              <p className="mt-1 text-sm text-slate-600">
                Saved records from your local results database
              </p>
              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Video</th>
                      <th className="pb-3 pr-4 font-semibold">Completed</th>
                      <th className="pb-3 pr-4 font-semibold">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100 align-top">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          {entry.videoName}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {formatDateTime(entry.completedAt)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-semibold text-slate-900">
                            {entry.score}/{entry.totalQuestions}
                          </span>
                          <span className="ml-2 text-slate-500">
                            ({entry.percentage}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white/85 p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

function HighlightCard({
  label,
  title,
  value,
  detail,
}: {
  label: string;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <h3 className="mt-2 text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-xl font-bold text-sky-700">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}
