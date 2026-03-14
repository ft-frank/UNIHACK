import { useEffect, useState, type ReactNode } from "react";
import type { VideoScoreRecord } from "../lib/scoreHistory";

type StatisticsPageProps = {
  history: VideoScoreRecord[];
  onClearHistory: () => void;
  isDarkMode: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

const toDayKey = (value: string | Date) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
    .toISOString()
    .slice(0, 10);
};

const fromDayKey = (dayKey: string) => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const diffInDays = (left: string, right: string) =>
  Math.round((fromDayKey(left).getTime() - fromDayKey(right).getTime()) / DAY_MS);

export default function StatisticsPage({
  history,
  onClearHistory,
  isDarkMode,
}: StatisticsPageProps) {
  const [zoomedPanel, setZoomedPanel] = useState<"garden" | "trend" | null>(null);
  const [closingPanel, setClosingPanel] = useState(false);
  useEffect(() => {
    if (!closingPanel) return;

    const timeoutId = window.setTimeout(() => {
      setZoomedPanel(null);
      setClosingPanel(false);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [closingPanel]);
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

  const dailyActivity = Array.from(
    history.reduce((map, entry) => {
      const dayKey = toDayKey(entry.completedAt);
      const current = map.get(dayKey) ?? {
        dayKey,
        label: formatDay(entry.completedAt),
        sessions: 0,
        totalPercentage: 0,
      };

      current.sessions += 1;
      current.totalPercentage += entry.percentage;
      map.set(dayKey, current);
      return map;
    }, new Map<string, {
      dayKey: string;
      label: string;
      sessions: number;
      totalPercentage: number;
    }>())
  )
    .map((entry) => ({
      dayKey: entry[1].dayKey,
      label: entry[1].label,
      sessions: entry[1].sessions,
      averagePercentage: Math.round(
        entry[1].totalPercentage / Math.max(entry[1].sessions, 1)
      ),
    }))
    .sort((a, b) => fromDayKey(a.dayKey).getTime() - fromDayKey(b.dayKey).getTime());

  const latestActivityDay = dailyActivity[dailyActivity.length - 1]?.dayKey ?? null;
  const todayKey = toDayKey(new Date());
  const daysSinceLastVisit = latestActivityDay
    ? diffInDays(todayKey, latestActivityDay)
    : null;

  let currentStreak = 0;
  for (let index = dailyActivity.length - 1; index >= 0; index -= 1) {
    const currentDay = dailyActivity[index];
    const nextDay = dailyActivity[index + 1];

    if (!nextDay) {
      currentStreak = 1;
      continue;
    }

    if (diffInDays(nextDay.dayKey, currentDay.dayKey) === 1) {
      currentStreak += 1;
      continue;
    }

    break;
  }

  const longestStreak = dailyActivity.reduce<{ best: number; current: number }>(
    (longest, day, index) => {
      if (index === 0) {
        return { best: 1, current: 1 };
      }

      const previousDay = dailyActivity[index - 1];
      const nextCurrent =
        diffInDays(day.dayKey, previousDay.dayKey) === 1 ? longest.current + 1 : 1;

      return {
        best: Math.max(longest.best, nextCurrent),
        current: nextCurrent,
      };
    },
    { best: 0, current: 0 }
  ).best;

  const streakActive = daysSinceLastVisit !== null && daysSinceLastVisit <= 1;
  const streakDisplay = streakActive ? currentStreak : 0;
  const freezeCount = daysSinceLastVisit === 1 ? 1 : 0;
  const weeklyActivity = dailyActivity.slice(-7);
  const activeDaysThisWeek = weeklyActivity.length;
  const gardenFriendCount = Math.max(1, Math.min(streakDisplay || 1, 10));
  const flowerCount = Math.max(3, Math.min(activeDaysThisWeek + 2, 9));
  const gardenMood = streakDisplay >= 7 ? "thriving" : streakDisplay >= 3 ? "growing" : "sprouting";
  const streakMessage = !latestActivityDay
    ? "Finish a video to plant your first garden friend."
    : streakActive && daysSinceLastVisit === 0
      ? "You checked in today, so your garden keeps growing."
      : streakActive
        ? "You were here yesterday. Drop in today to keep the streak alive."
        : "Your garden has gone quiet for now. Come back today to start a fresh streak.";

  return (
    <div className="space-y-8">
      <section className={`animate-fade-up rounded-[28px] border p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className={`text-sm font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-sky-300" : "text-sky-700"}`}>
              Statistics
            </p>
            <h1 className={`mt-2 text-3xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
              Track how your Echolearn performance changes over time
            </h1>
            <p className={`mt-3 max-w-2xl text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              Every completed video is saved in a local browser database with its
              name, completion time, and final score.
            </p>
          </div>

          {history.length > 0 && (
            <button
              onClick={onClearHistory}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${isDarkMode ? "border-rose-900 text-rose-300 hover:bg-rose-950/40" : "border-rose-200 text-rose-700 hover:bg-rose-50"}`}
            >
              Clear history
            </button>
          )}
        </div>
      </section>

      {history.length === 0 ? (
        <section className={`rounded-[28px] border border-dashed p-10 text-center shadow-sm ${isDarkMode ? "border-slate-700 bg-slate-900/65" : "border-slate-300 bg-white/70"}`}>
          <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>No completed videos yet</h2>
          <p className={`mt-3 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
            Finish a video from the dashboard and your first score record will show
            up here automatically.
          </p>
        </section>
      ) : (
        <>
          <ExpandablePanelModal
            isOpen={zoomedPanel !== null}
            isClosing={closingPanel}
            onClose={() => {
              setClosingPanel(true);
            }}
            isDarkMode={isDarkMode}
            title={zoomedPanel === "garden" ? "Echolearn Garden" : "Recent Trend"}
            subtitle={
              zoomedPanel === "garden"
                ? "A larger view of your streak garden and its little crew."
                : "A zoomed view of your recent completion performance."
            }
          >
            {zoomedPanel === "garden" ? (
              <GardenScene
                friendCount={gardenFriendCount}
                flowerCount={Math.max(flowerCount + 2, 6)}
                streakDisplay={streakDisplay}
                activeDaysThisWeek={activeDaysThisWeek}
                streakActive={streakActive}
                isDarkMode={isDarkMode}
                isExpanded
              />
            ) : zoomedPanel === "trend" ? (
              <RecentTrendExpanded
                recentTrend={recentTrend}
                isDarkMode={isDarkMode}
              />
            ) : null}
          </ExpandablePanelModal>

          <section
            className={`animate-fade-up rounded-[30px] border p-6 shadow-[0_20px_70px_rgba(34,197,94,0.12)] ${
              isDarkMode
                ? "border-emerald-900/50 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.65),_transparent_38%),linear-gradient(180deg,_#052e16_0%,_#0f172a_42%,_#111827_100%)]"
                : "border-emerald-200 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.85),_transparent_38%),linear-gradient(180deg,_#f0fdf4_0%,_#dcfce7_42%,_#ecfccb_100%)]"
            }`}
          >
            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className={`text-sm font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                  Daily streak garden
                </p>
                <h2 className={`mt-2 text-3xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                  Come back each day and grow your little crew
                </h2>
                <p className={`mt-3 max-w-2xl text-sm ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  Each day with at least one completed video adds another garden friend.
                  Miss more than one day and the streak resets, so the garden starts
                  fresh again.
                </p>

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <GardenStatCard
                    label="Current streak"
                    value={`${streakDisplay} day${streakDisplay === 1 ? "" : "s"}`}
                    detail={streakActive ? "Active now" : "Ready to restart"}
                    isDarkMode={isDarkMode}
                  />
                  <GardenStatCard
                    label="Longest streak"
                    value={`${longestStreak} day${longestStreak === 1 ? "" : "s"}`}
                    detail="Best run so far"
                    isDarkMode={isDarkMode}
                  />
                  <GardenStatCard
                    label="Streak freeze"
                    value={`${freezeCount}`}
                    detail="You can save it by visiting today"
                    isDarkMode={isDarkMode}
                  />
                </div>

                <div className={`mt-6 rounded-[24px] border p-4 ${isDarkMode ? "border-emerald-900/60 bg-slate-950/35" : "border-emerald-200/80 bg-white/55"}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`animate-soft-float rounded-full px-3 py-1 text-sm font-semibold ${isDarkMode ? "bg-emerald-950 text-emerald-300" : "bg-emerald-100 text-emerald-700"}`}>
                      Mood: {gardenMood}
                    </span>
                    <span className={`animate-soft-float rounded-full px-3 py-1 text-sm font-semibold ${isDarkMode ? "bg-amber-950 text-amber-300" : "bg-amber-100 text-amber-700"}`}>
                      Active days this week: {activeDaysThisWeek}
                    </span>
                    {latestActivityDay && (
                      <span className={`animate-soft-float rounded-full px-3 py-1 text-sm font-semibold ${isDarkMode ? "bg-sky-950 text-sky-300" : "bg-sky-100 text-sky-700"}`}>
                        Last visit: {formatDay(latestActivityDay)}
                      </span>
                    )}
                  </div>
                  <p className={`mt-3 text-sm font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    {streakMessage}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setClosingPanel(false);
                  setZoomedPanel("garden");
                }}
                className="group text-left"
              >
                <GardenScene
                  friendCount={gardenFriendCount}
                  flowerCount={flowerCount}
                  streakDisplay={streakDisplay}
                  activeDaysThisWeek={activeDaysThisWeek}
                  streakActive={streakActive}
                  isDarkMode={isDarkMode}
                />
              </button>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Completed sessions"
              value={`${totalSessions}`}
              detail="Total finished video runs saved locally"
              isDarkMode={isDarkMode}
            />
            <StatCard
              label="Unique videos"
              value={`${completedVideos}`}
              detail="Different videos you have completed"
              isDarkMode={isDarkMode}
            />
            <StatCard
              label="Average score"
              value={`${averagePercentage}%`}
              detail="Mean performance across all sessions"
              isDarkMode={isDarkMode}
            />
            <StatCard
              label="Improvement"
              value={`${improvement >= 0 ? "+" : ""}${improvement}%`}
              detail="Latest run compared with your earliest saved run"
              isDarkMode={isDarkMode}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <button
              type="button"
              onClick={() => {
                setClosingPanel(false);
                setZoomedPanel("trend");
              }}
              className={`animate-fade-up rounded-[28px] border p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}
            >
              <div>
                <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>Recent trend</h2>
                <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  Last {recentTrend.length} completions by score percentage
                </p>
              </div>

              <div className="mt-8 flex h-72 items-end gap-3">
                {recentTrend.map((entry) => (
                  <div key={entry.id} className="flex flex-1 flex-col items-center gap-3">
                    <div className="flex h-full w-full items-end">
                      <div
                        className="w-full rounded-t-2xl bg-gradient-to-t from-sky-600 via-cyan-500 to-emerald-400 px-2 pt-3 text-center text-xs font-bold text-white shadow-[0_16px_32px_rgba(14,116,144,0.28)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(14,116,144,0.35)]"
                        style={{ height: `${Math.max(entry.percentage, 8)}%` }}
                      >
                        {entry.percentage}%
                      </div>
                    </div>
                    <div className={`text-center text-xs font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {formatDay(entry.completedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </button>

            <div className={`animate-fade-up rounded-[28px] border p-6 shadow-sm ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
              <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>Highlights</h2>
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
                  isDarkMode={isDarkMode}
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
                  isDarkMode={isDarkMode}
                />
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.05fr_1.15fr]">
            <div className={`animate-fade-up rounded-[28px] border p-6 shadow-sm ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
              <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>Video leaderboard</h2>
              <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                Which videos are giving you the strongest results
              </p>
              <div className="mt-6 space-y-3">
                {leaderboard.slice(0, 6).map((item) => (
                  <div
                    key={item.videoId}
                    className={`rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${isDarkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-slate-50/80"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className={`font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{item.videoName}</p>
                        <p className={`mt-1 text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
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

            <div className={`animate-fade-up rounded-[28px] border p-6 shadow-sm ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
              <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>Completion history</h2>
              <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                Saved records from your local results database
              </p>
              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDarkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>
                      <th className="pb-3 pr-4 font-semibold">Video</th>
                      <th className="pb-3 pr-4 font-semibold">Completed</th>
                      <th className="pb-3 pr-4 font-semibold">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className={`align-top ${isDarkMode ? "border-b border-slate-800" : "border-b border-slate-100"}`}>
                        <td className={`py-3 pr-4 font-medium ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                          {entry.videoName}
                        </td>
                        <td className={`py-3 pr-4 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                          {formatDateTime(entry.completedAt)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                            {entry.score}/{entry.totalQuestions}
                          </span>
                          <span className={`ml-2 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
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

function ExpandablePanelModal({
  isOpen,
  isClosing,
  onClose,
  isDarkMode,
  title,
  subtitle,
  children,
}: {
  isOpen: boolean;
  isClosing: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRender(false);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  if (!shouldRender) return null;

  const leaving = isClosing || !isOpen;

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm ${
        leaving ? "animate-popup-overlay-out" : "animate-popup-overlay-in"
      }`}
    >
      <button
        onClick={onClose}
        className="absolute inset-0"
        aria-label={`Close ${title} popup`}
      />
      <div
        className={`relative z-[81] w-full max-w-5xl overflow-hidden rounded-[32px] border shadow-[0_30px_90px_rgba(15,23,42,0.38)] ${
          leaving ? "animate-popup-panel-out" : "animate-popup-panel-in"
        } ${
          isDarkMode
            ? "border-slate-800 bg-slate-950 text-slate-100"
            : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <div className={`flex items-start justify-between gap-4 border-b px-6 py-5 ${isDarkMode ? "border-slate-800 bg-slate-950/80" : "border-slate-200 bg-slate-50/70"}`}>
          <div>
            <h3 className="text-2xl font-bold">{title}</h3>
            <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className={`rounded-full border p-2 transition-all duration-300 hover:-translate-y-0.5 ${
              isDarkMode
                ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                : "border-slate-200 text-slate-600 hover:bg-white"
            }`}
            aria-label={`Close ${title}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[80vh] overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function RecentTrendExpanded({
  recentTrend,
  isDarkMode,
}: {
  recentTrend: VideoScoreRecord[];
  isDarkMode: boolean;
}) {
  return (
    <div className={`rounded-[28px] border p-6 ${isDarkMode ? "border-slate-800 bg-slate-900/70" : "border-slate-200 bg-white/85"}`}>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {recentTrend.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-[24px] border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${isDarkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50/80"}`}
          >
            <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              {formatDay(entry.completedAt)}
            </p>
            <div className="mt-4 h-52 overflow-hidden rounded-[20px] bg-slate-950/10 p-3">
              <div className="flex h-full items-end">
                <div
                  className="w-full rounded-t-[18px] bg-gradient-to-t from-sky-600 via-cyan-500 to-emerald-400 text-center text-sm font-bold text-white shadow-[0_18px_36px_rgba(14,116,144,0.32)]"
                  style={{ height: `${Math.max(entry.percentage, 8)}%` }}
                >
                  <div className="pt-3">{entry.percentage}%</div>
                </div>
              </div>
            </div>
            <p className={`mt-4 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              {entry.videoName}
            </p>
            <p className={`mt-1 text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              Score {entry.score}/{entry.totalQuestions}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  isDarkMode,
}: {
  label: string;
  value: string;
  detail: string;
  isDarkMode: boolean;
}) {
  return (
    <div className={`animate-fade-up rounded-[24px] border p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
      <p className={`text-sm font-semibold ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-3 text-3xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{value}</p>
      <p className={`mt-2 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{detail}</p>
    </div>
  );
}

function HighlightCard({
  label,
  title,
  value,
  detail,
  isDarkMode,
}: {
  label: string;
  title: string;
  value: string;
  detail: string;
  isDarkMode: boolean;
}) {
  return (
    <div className={`animate-fade-up rounded-[24px] border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${isDarkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50/80"}`}>
      <p className={`text-sm font-semibold ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <h3 className={`mt-2 text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{title}</h3>
      <p className="mt-2 text-xl font-bold text-sky-700">{value}</p>
      <p className={`mt-2 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{detail}</p>
    </div>
  );
}

function GardenStatCard({
  label,
  value,
  detail,
  isDarkMode,
}: {
  label: string;
  value: string;
  detail: string;
  isDarkMode: boolean;
}) {
  return (
    <div className={`animate-fade-up rounded-[22px] border p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${isDarkMode ? "border-emerald-900/60 bg-slate-900/45" : "border-emerald-200 bg-white/65"}`}>
      <p className={`text-sm font-semibold ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>{label}</p>
      <p className={`mt-2 text-3xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{value}</p>
      <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{detail}</p>
    </div>
  );
}

function GardenScene({
  friendCount,
  flowerCount,
  streakDisplay,
  activeDaysThisWeek,
  streakActive,
  isDarkMode,
  isExpanded = false,
}: {
  friendCount: number;
  flowerCount: number;
  streakDisplay: number;
  activeDaysThisWeek: number;
  streakActive: boolean;
  isDarkMode: boolean;
  isExpanded?: boolean;
}) {
  const flowers = Array.from({ length: flowerCount }, (_, index) => ({
    id: index,
    left: 8 + ((index * 11) % 84),
    delay: `${index * 0.35}s`,
    color:
      index % 3 === 0
        ? "from-pink-300 to-rose-400"
        : index % 3 === 1
          ? "from-yellow-200 to-amber-300"
          : "from-sky-300 to-cyan-400",
    height: 20 + (index % 3) * 10,
  }));

  const friends = Array.from({ length: friendCount }, (_, index) => ({
    id: index,
    left: 8 + ((index * 9) % 76),
    delay: `${index * 0.5}s`,
    duration: `${7 + (index % 4) * 1.2}s`,
    drift: `${16 + (index % 3) * 10}px`,
    rise: `${4 + (index % 3) * 3}px`,
    tone:
      index % 4 === 0
        ? "bg-amber-200"
        : index % 4 === 1
          ? "bg-rose-200"
          : index % 4 === 2
            ? "bg-sky-200"
            : "bg-lime-200",
  }));

  return (
    <div className={`animate-fade-up rounded-[28px] border p-4 ${isDarkMode ? "border-emerald-900/50 bg-slate-950/35" : "border-emerald-200/80 bg-white/50"}`}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className={`text-sm font-semibold ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>Garden view</p>
          <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
            {streakDisplay > 0
              ? `${friendCount} friend${friendCount === 1 ? "" : "s"} playing in the garden`
              : "A fresh patch waiting for today’s visit"}
          </p>
        </div>
        <div className={`rounded-full px-3 py-2 text-right shadow-sm ${isDarkMode ? "bg-slate-900/80" : "bg-white/75"}`}>
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
            Weekly check-ins
          </p>
          <p className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{activeDaysThisWeek}/7</p>
        </div>
      </div>

      <div className={`relative overflow-hidden rounded-[24px] border ${isExpanded ? "h-[520px]" : "h-[320px]"} ${isDarkMode ? "border-emerald-950/60 bg-[linear-gradient(180deg,_#082f49_0%,_#052e16_55%,_#14532d_100%)]" : "border-emerald-100 bg-[linear-gradient(180deg,_#dbeafe_0%,_#f0fdf4_50%,_#bbf7d0_100%)]"}`}>
        <div className={`absolute inset-x-0 bottom-0 h-28 ${isDarkMode ? "bg-[radial-gradient(circle_at_top,_rgba(74,222,128,0.28),_transparent_60%),linear-gradient(180deg,_#166534_0%,_#14532d_100%)]" : "bg-[radial-gradient(circle_at_top,_rgba(134,239,172,0.75),_transparent_60%),linear-gradient(180deg,_#86efac_0%,_#4ade80_100%)]"}`} />
        <div className={`absolute right-6 top-5 h-16 w-16 rounded-full ${isDarkMode ? "bg-sky-200/70 shadow-[0_0_40px_rgba(125,211,252,0.35)]" : "bg-yellow-200/90 shadow-[0_0_40px_rgba(253,224,71,0.65)]"}`} />
        <div className={`absolute left-6 top-8 h-10 w-24 rounded-full blur-sm ${isDarkMode ? "bg-slate-200/20" : "bg-white/75"}`} />
        <div className={`absolute left-24 top-16 h-8 w-20 rounded-full blur-sm ${isDarkMode ? "bg-slate-200/15" : "bg-white/70"}`} />
        <div className={`absolute right-20 top-20 h-9 w-24 rounded-full blur-sm ${isDarkMode ? "bg-slate-200/15" : "bg-white/70"}`} />

        {flowers.map((flower) => (
          <div
            key={flower.id}
            className={`absolute ${isExpanded ? "bottom-24" : "bottom-16"}`}
            style={{ left: `${flower.left}%` }}
          >
            <div
              className="mx-auto w-1 rounded-full bg-emerald-600"
              style={{ height: flower.height }}
            />
            <div
              className={`relative -mt-1 h-4 w-4 rounded-full bg-gradient-to-br ${flower.color} shadow-sm animate-[garden-bob_2.8s_ease-in-out_infinite]`}
              style={{ animationDelay: flower.delay }}
            />
          </div>
        ))}

        {friends.map((friend) => (
          <div
            key={friend.id}
            className={`absolute will-change-transform ${isExpanded ? "bottom-16" : "bottom-10"}`}
            style={{
              left: `${friend.left}%`,
              ["--garden-drift" as string]: friend.drift,
              ["--garden-rise" as string]: friend.rise,
              animation: `garden-run ${friend.duration} ease-in-out ${friend.delay} infinite`,
            }}
          >
            <div className="relative animate-[garden-hop_0.8s_ease-in-out_infinite]">
              <div className={`h-8 w-8 rounded-full border border-slate-700/10 ${friend.tone} shadow-[0_10px_18px_rgba(15,23,42,0.14)]`} />
              <div className="absolute left-[6px] top-[10px] h-1.5 w-1.5 rounded-full bg-slate-700" />
              <div className="absolute right-[6px] top-[10px] h-1.5 w-1.5 rounded-full bg-slate-700" />
              <div className="absolute left-1/2 top-[15px] h-1 w-3 -translate-x-1/2 rounded-full bg-slate-700/80" />
              <div className="absolute -left-0.5 top-2 h-2.5 w-2.5 rounded-full border border-slate-700/10 bg-inherit" />
              <div className="absolute -right-0.5 top-2 h-2.5 w-2.5 rounded-full border border-slate-700/10 bg-inherit" />
              <div className="absolute left-1.5 top-7 h-2 w-1 rounded-full bg-slate-700/60" />
              <div className="absolute right-1.5 top-7 h-2 w-1 rounded-full bg-slate-700/60" />
            </div>
          </div>
        ))}

        <div className={`absolute left-4 right-4 flex items-center justify-between rounded-2xl px-4 py-3 shadow-sm backdrop-blur ${isExpanded ? "bottom-6" : "bottom-4"} ${isDarkMode ? "bg-slate-950/65" : "bg-white/70"}`}>
          <div>
            <p className={`text-sm font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
              {streakActive ? "Garden is active today" : "Garden is resting"}
            </p>
            <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              Finish one video each day to keep adding new friends.
            </p>
          </div>
          <div className="text-right">
            <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              Crew size
            </p>
            <p className="text-2xl font-bold text-emerald-700">{friendCount}</p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes garden-bob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }

        @keyframes garden-hop {
          0%, 100% { transform: translateY(0px) scaleX(1); }
          50% { transform: translateY(-3px) scaleX(0.98); }
        }

        @keyframes garden-run {
          0% { transform: translate3d(calc(var(--garden-drift) * -1), 0px, 0) scaleX(1); }
          25% { transform: translate3d(var(--garden-drift), calc(var(--garden-rise) * -1), 0) scaleX(1); }
          50% { transform: translate3d(calc(var(--garden-drift) * 0.35), 0px, 0) scaleX(-1); }
          75% { transform: translate3d(calc(var(--garden-drift) * -1), calc(var(--garden-rise) * -1), 0) scaleX(-1); }
          100% { transform: translate3d(calc(var(--garden-drift) * -1), 0px, 0) scaleX(1); }
        }
      `}</style>
    </div>
  );
}
