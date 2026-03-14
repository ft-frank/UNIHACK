import { useEffect, useRef, useState } from "react";
import Settings, { type UserSettings } from "./components/settings";
import StatisticsPage from "./components/StatisticsPage";
import {
  clearStoredHistory,
  getStoredHistory,
  saveScoreRecord,
  type VideoScoreRecord,
} from "./lib/scoreHistory";
import type { Question, QuestionsJob } from "./questions";
import { createQuestionsJob, getQuestionsJob } from "./questions";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: any;
  }
}

const POLL_INTERVAL_MS = 1500;

export default function App() {
  const [activePage, setActivePage] = useState<"dashboard" | "statistics">(
    "dashboard"
  );
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState("");
  const [pendingVideoId, setPendingVideoId] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generationStage, setGenerationStage] = useState("Waiting to start");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<VideoScoreRecord[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({
    difficulty: "Beginner",
    frequency: "3-5",
    specificGroups: "",
    specificSounds: "",
  });

  const playerRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  const processedRef = useRef<number[]>([]);
  const questionsRef = useRef<Question[]>([]);
  const hasRecordedCompletionRef = useRef(false);
  const scoreRef = useRef(0);
  const videoTitleRef = useRef("");

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }

    setHistory(getStoredHistory());
  }, []);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    videoTitleRef.current = videoTitle;
  }, [videoTitle]);

  const startPolling = () => {
    stopPolling();
    intervalRef.current = window.setInterval(() => {
      if (!playerRef.current) return;

      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      const question = questionsRef.current.find(
        (entry) =>
          currentTime >= entry.timestamp &&
          !processedRef.current.includes(entry.timestamp)
      );

      if (question) {
        processedRef.current.push(question.timestamp);
        playerRef.current.pauseVideo();
        setCurrentQuestion(question);
      }
    }, 200);
  };

  const stopPolling = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }
  };

  const handleVideoComplete = () => {
    if (hasRecordedCompletionRef.current || !videoId) return;

    hasRecordedCompletionRef.current = true;

    const nextHistory = saveScoreRecord({
      videoId,
      videoName:
        playerRef.current?.getVideoData?.().title ||
        videoTitleRef.current ||
        `Video ${videoId}`,
      completedAt: new Date().toISOString(),
      score: scoreRef.current,
      totalQuestions: questionsRef.current.length,
    });

    setVideoTitle(playerRef.current?.getVideoData?.().title || videoTitleRef.current);
    setHistory(nextHistory);
  };

  useEffect(() => {
    if (!videoId || !window.YT) return;
    if (playerRef.current) playerRef.current.destroy();

    playerRef.current = new window.YT.Player("yt-player", {
      height: "100%",
      width: "100%",
      videoId,
      playerVars: { autoplay: 1, origin: window.location.origin },
      events: {
        onReady: () => {
          setVideoTitle(playerRef.current?.getVideoData?.().title ?? "");
          playerRef.current.playVideo();
          startPolling();
        },
        onStateChange: (event: any) => {
          if (event.data === window.YT.PlayerState.PLAYING) {
            setVideoTitle(
              playerRef.current?.getVideoData?.().title ?? "Current video"
            );
            startPolling();
            return;
          }

          stopPolling();

          if (event.data === window.YT.PlayerState.ENDED) {
            handleVideoComplete();
          }
        },
      },
    });

    return () => stopPolling();
  }, [videoId]);

  const waitForQuestions = async (jobId: string) => {
    while (true) {
      const job: QuestionsJob = await getQuestionsJob(jobId);
      setGenerationProgress(job.progress);
      setGenerationStage(job.stage);

      if (job.status === "completed") {
        return job.questions ?? [];
      }

      if (job.status === "failed") {
        throw new Error(job.error ?? "Question generation failed");
      }

      await new Promise((resolve) =>
        window.setTimeout(resolve, POLL_INTERVAL_MS)
      );
    }
  };

  const handleLoadVideo = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextVideoId = extractVideoId(urlInput);
    if (!nextVideoId) {
      setLoadError("Enter a valid YouTube URL.");
      return;
    }

    stopPolling();
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    processedRef.current = [];
    questionsRef.current = [];
    hasRecordedCompletionRef.current = false;
    setCurrentQuestion(null);
    setFeedback(null);
    setScore(0);
    setVideoTitle("");
    setVideoId("");
    setPendingVideoId(nextVideoId);
    setLoadError(null);
    setGenerationStage("Queued");
    setGenerationProgress(0);
    setActivePage("dashboard");
    setIsNavOpen(false);

    setLoading(true);
    try {
      const jobId = await createQuestionsJob(urlInput, settings);
      const fetchedData = await waitForQuestions(jobId);
      questionsRef.current = fetchedData;
      setGenerationProgress(100);
      setGenerationStage("Complete");
      setPendingVideoId("");
      setVideoId(nextVideoId);
    } catch (error) {
      setPendingVideoId("");
      setLoadError(
        error instanceof Error ? error.message : "Question generation failed"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerClick = (index: number) => {
    if (!currentQuestion) return;

    if (index === currentQuestion.answerIndex) {
      setFeedback("Correct!");
      setScore((previous) => previous + 1);
      return;
    }

    setFeedback(
      `Incorrect. Answer: ${currentQuestion.choices[currentQuestion.answerIndex]}`
    );
  };

  const continueVideo = () => {
    setCurrentQuestion(null);
    setFeedback(null);
    playerRef.current?.playVideo();
    startPolling();
  };

  const handleClearHistory = () => {
    clearStoredHistory();
    setHistory([]);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.22),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_42%,_#f8fafc_100%)] font-sans text-slate-800">
      <button
        onClick={() => setIsNavOpen(true)}
        className="fixed left-4 top-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white/90 text-slate-700 shadow-lg backdrop-blur transition hover:bg-white"
        aria-label="Open navigation menu"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
          />
        </svg>
      </button>

      {isNavOpen && (
        <button
          onClick={() => setIsNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px]"
          aria-label="Close navigation menu"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-slate-200 bg-[#081120] px-5 py-6 text-white shadow-2xl transition-transform duration-300 ${
          isNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              UNIHACK
            </p>
            <h2 className="mt-2 text-2xl font-bold">Learning Hub</h2>
          </div>
          <button
            onClick={() => setIsNavOpen(false)}
            className="rounded-full border border-white/15 p-2 text-slate-200 transition hover:bg-white/10"
            aria-label="Close navigation menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <nav className="mt-10 space-y-3">
          <NavButton
            label="User Dashboard"
            active={activePage === "dashboard"}
            onClick={() => {
              setActivePage("dashboard");
              setIsNavOpen(false);
            }}
          />
          <NavButton
            label="Statistics"
            active={activePage === "statistics"}
            onClick={() => {
              setActivePage("statistics");
              setIsNavOpen(false);
            }}
          />
        </nav>

        <div className="mt-auto rounded-[24px] border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white">Saved sessions</p>
          <p className="mt-2 text-3xl font-bold text-cyan-300">{history.length}</p>
          <p className="mt-2 text-sm text-slate-300">
            Completed videos are stored locally on this device.
          </p>
        </div>
      </aside>

      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentSettings={settings}
        onSave={(newSettings) => {
          setSettings(newSettings);
        }}
      />

      <header className="flex items-center justify-between border-b border-slate-200/80 px-20 py-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
            {activePage === "dashboard" ? "Dashboard" : "Statistics"}
          </p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">
            {activePage === "dashboard"
              ? "YouTube Interactive Quiz"
              : "Performance Overview"}
          </h1>
        </div>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="rounded-md border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
        </button>
      </header>

      {activePage === "dashboard" ? (
        <>
          <div className="border-b border-slate-200/80 bg-white/40 px-6 py-4 backdrop-blur">
            <form
              onSubmit={handleLoadVideo}
              className="mx-auto flex max-w-[1600px] flex-col gap-4 lg:flex-row lg:items-center"
            >
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800"
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-2xl bg-[#0b0f19] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Generating..." : "Load Video"}
              </button>
              {loadError && (
                <p className="text-sm font-medium text-rose-600">{loadError}</p>
              )}
            </form>
          </div>

          <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-12 lg:items-start">
            <div className="flex flex-col lg:col-span-8">
              <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                {loading ? (
                  <GenerationPanel
                    progress={generationProgress}
                    stage={generationStage}
                  />
                ) : videoId ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
                          Active video
                        </p>
                        <h2 className="mt-1 text-lg font-bold text-slate-900">
                          {videoTitle || "Loading video details..."}
                        </h2>
                      </div>
                      <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                        Score: {score} / {questionsRef.current.length || "-"}
                      </div>
                    </div>

                    <div className="relative aspect-video overflow-hidden rounded-[24px] border border-slate-200 bg-black">
                      <div id="yt-player" className="absolute inset-0" />
                    </div>
                  </>
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-[24px] border-2 border-dashed border-slate-200 bg-slate-50">
                    <p className="font-medium text-slate-400">
                      {pendingVideoId
                        ? "Generation finished. Preparing video..."
                        : "Load a video to get started"}
                    </p>
                  </div>
                )}
              </div>

              {!loading && videoId && (
                <p className="mt-4 text-sm font-medium text-slate-500">
                  Pause the video to reveal quiz questions. Finishing the video
                  saves this score to your local results database.
                </p>
              )}
            </div>

            <div className="flex w-full flex-col lg:col-span-4">
              <div className="mb-4">
                <h2 className="text-[1.15rem] font-bold text-slate-800">
                  Quiz panel
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Answer in-video questions and keep your streak moving.
                </p>
              </div>

              <div className="flex min-h-[220px] flex-col justify-center rounded-[28px] border border-slate-200 bg-white/85 p-8 shadow-sm">
                {currentQuestion ? (
                  <div className="flex flex-col">
                    <h3 className="mb-5 text-center text-lg font-bold text-slate-800">
                      {currentQuestion.question}
                    </h3>

                    {!feedback ? (
                      <div className="flex flex-col gap-3">
                        {currentQuestion.choices.map((choice, index) => (
                          <button
                            key={index}
                            onClick={() => handleAnswerClick(index)}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-all hover:border-slate-800 hover:bg-slate-50"
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <p
                          className={`text-base font-bold ${
                            feedback === "Correct!"
                              ? "text-emerald-600"
                              : "text-rose-600"
                          }`}
                        >
                          {feedback}
                        </p>
                        <button
                          onClick={continueVideo}
                          className="mt-2 w-full rounded-2xl bg-[#0b0f19] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                        >
                          Continue Video
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-sm font-medium text-slate-500/80">
                    {loading
                      ? `${generationStage} (${generationProgress}%)`
                      : videoId
                      ? "Pause the video to start answering questions"
                      : "Questions will appear after generation completes"}
                  </p>
                )}
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Progress snapshot
                </p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <SnapshotCard label="Current score" value={`${score}`} />
                  <SnapshotCard label="Saved sessions" value={`${history.length}`} />
                </div>
              </div>
            </div>
          </main>
        </>
      ) : (
        <main className="mx-auto max-w-[1600px] px-6 py-8">
          <StatisticsPage
            history={history}
            onClearHistory={handleClearHistory}
          />
        </main>
      )}
    </div>
  );
}

function extractVideoId(input: string) {
  try {
    const parsed = new URL(input);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "").slice(0, 11);
    }

    const id = parsed.searchParams.get("v");
    if (id) return id.slice(0, 11);

    const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    return shortsMatch?.[1] ?? "";
  } catch {
    const fallbackMatch = input.match(/([a-zA-Z0-9_-]{11})/);
    return fallbackMatch?.[1] ?? "";
  }
}

function GenerationPanel({
  progress,
  stage,
}: {
  progress: number;
  stage: string;
}) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-[24px] border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.2),_transparent_35%),linear-gradient(135deg,#020617,#0f172a_55%,#111827)] text-white">
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.08),transparent)] animate-[generationSweep_2.4s_linear_infinite]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <div className="mb-8 flex gap-3">
          <span className="h-3 w-3 rounded-full bg-sky-300 animate-[pulse_1s_ease-in-out_infinite]" />
          <span className="h-3 w-3 rounded-full bg-cyan-200 animate-[pulse_1s_ease-in-out_0.2s_infinite]" />
          <span className="h-3 w-3 rounded-full bg-blue-100 animate-[pulse_1s_ease-in-out_0.4s_infinite]" />
        </div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.32em] text-sky-200/80">
          Generation In Progress
        </p>
        <h2 className="mb-2 text-3xl font-bold">Preparing your quiz</h2>
        <p className="mb-8 text-slate-300">{stage}</p>
        <div className="w-full max-w-xl">
          <div className="mb-2 flex justify-between text-sm text-slate-300">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-blue-200 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
      <style>{`
        @keyframes generationSweep {
          from { transform: translateX(-120%); }
          to { transform: translateX(120%); }
        }
      `}</style>
    </div>
  );
}

function NavButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
        active
          ? "bg-cyan-400 text-slate-950"
          : "bg-white/5 text-slate-200 hover:bg-white/10"
      }`}
    >
      <span>{label}</span>
      <span className="text-xs uppercase tracking-[0.2em]">
        {active ? "Open" : "View"}
      </span>
    </button>
  );
}

function SnapshotCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
