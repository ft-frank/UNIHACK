import { useCallback, useEffect, useRef, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import Settings, { type UserSettings } from "./components/settings";
import StatisticsPage from "./components/StatisticsPage";
import PastAttemptsPage from "./components/PastAttemptsPage";
import {
  clearStoredHistory,
  getStoredHistory,
  saveScoreRecord,
  type VideoScoreRecord,
} from "./lib/scoreHistory";
import {
  ensureValidSession,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  type AuthSession,
  type SignUpResult,
} from "./lib/auth";
import { apiFetch, backendHasPath } from "./lib/api";
import type { Question, QuestionsJob, MultipleChoiceQuestion, FillInTheBlanksQuestion } from "./questions";
import {
  createQuestionsJob,
  createUploadQuestionsJob,
  getQuestionsJob,
  submitQuestionResult,
} from "./questions";

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: (() => void) | null;
  }
}

type YouTubePlayer = {
  destroy?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime?: () => number;
  getVideoData?: () => { title?: string };
};

type YouTubeApi = {
  Player: new (elementId: string, config: {
    height: string; width: string; videoId: string;
    playerVars: { autoplay: number; origin: string };
    events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  }) => YouTubePlayer;
  PlayerState: { PLAYING: number; ENDED: number };
};

type MediaKind = "youtube" | "audio-upload" | "video-upload";

type UploadedMedia = {
  id: string; kind: MediaKind; file: File; objectUrl: string; title: string;
};

type ConfettiPiece = {
  id: number; color: string; left: number; top: number; size: number;
  dx: number; dy: number; rotation: number; duration: number; delay: number;
};

const POLL_INTERVAL_MS = 1500;
const CONFETTI_COLORS = ["#3A6EAE", "#F4A261", "#2D6A4F", "#52B788", "#1C1B18", "#7A7570"];

const defaultSettings: UserSettings = {
  type: "Cochlear",
  difficulty: "Beginner",
  frequency: "3-5",
  cochlearAssessmentMode: "multiple-choice",
  specificGroups: "",
  specificSounds: "",
  languageFocus: "Both",
  nativeLanguage: "",
};

const mergeSettings = (incoming?: Partial<UserSettings> | null): UserSettings => ({
  ...defaultSettings,
  ...(incoming ?? {}),
});

const normalizeBlankAnswer = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ").trim();

const formatQuestionAnswer = (q: Question) =>
  q.kind === "fill-in-the-blanks" ? q.blanks.join(", ") : q.choices[q.answerIndex];

const getQuestionPrompt = (q: Question) =>
  q.kind === "fill-in-the-blanks" ? (q.promptSentence || q.sentenceWithBlanks) : q.question;

const isRecoverableError = (e: unknown) =>
  (e instanceof TypeError && e.message === "Failed to fetch") ||
  (e instanceof Error && e.message === "Not Found");

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authView, setAuthView] = useState<"landing" | "signin" | "signup">("landing");
  const [activePage, setActivePage] = useState<"dashboard" | "statistics" | "past-attempts">("dashboard");
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoId, setVideoId] = useState("");
  const [pendingVideoId, setPendingVideoId] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [mediaKind, setMediaKind] = useState<MediaKind>("youtube");
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [blankAnswers, setBlankAnswers] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [questionPhase, setQuestionPhase] = useState<
    "answering" | "awaiting-hint" | "replaying-hint" | "second-attempt" | "resolved"
  >("answering");
  const [hintUsed, setHintUsed] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generationStage, setGenerationStage] = useState("Waiting to start");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<VideoScoreRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [username, setUsername] = useState("friend");
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const [plantMinimized, setPlantMinimized] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const processedRef = useRef<number[]>([]);
  const questionsRef = useRef<Question[]>([]);
  const hasRecordedCompletionRef = useRef(false);
  const scoreRef = useRef(0);
  const videoTitleRef = useRef("");
  const currentQuestionRef = useRef<Question | null>(null);
  const hintReplayActiveRef = useRef(false);
  const questionPauseTimeRef = useRef<number | null>(null);
  const hintReplayTimeoutRef = useRef<number | null>(null);
  const resolveTimeoutRef = useRef<number | null>(null);
  const confettiTimeoutRef = useRef<number | null>(null);
  const confettiIdRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });

  // --- Media helpers ---
  const stopPolling = useCallback(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
  }, []);

  const getCurrentTime = useCallback(() => {
    if (mediaKind === "youtube") return playerRef.current?.getCurrentTime?.() ?? null;
    return mediaElementRef.current?.currentTime ?? null;
  }, [mediaKind]);

  const pauseMedia = useCallback(() => {
    if (mediaKind === "youtube") { playerRef.current?.pauseVideo?.(); return; }
    mediaElementRef.current?.pause();
  }, [mediaKind]);

  const playMedia = useCallback(() => {
    if (mediaKind === "youtube") { playerRef.current?.playVideo?.(); return; }
    mediaElementRef.current?.play().catch(() => undefined);
  }, [mediaKind]);

  const seekMedia = useCallback((s: number) => {
    if (mediaKind === "youtube") { playerRef.current?.seekTo?.(s, true); return; }
    if (mediaElementRef.current) mediaElementRef.current.currentTime = s;
  }, [mediaKind]);

  const destroyMedia = useCallback(() => {
    if (playerRef.current?.destroy) { playerRef.current.destroy(); playerRef.current = null; }
    if (mediaElementRef.current) {
      mediaElementRef.current.pause();
      mediaElementRef.current.currentTime = 0;
      mediaElementRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    intervalRef.current = window.setInterval(() => {
      const t = getCurrentTime();
      if (t === null || hintReplayActiveRef.current) return;
      const q = questionsRef.current.find(
        (e) => t >= e.timestamp && t < e.timestamp + 1 && !processedRef.current.includes(e.timestamp)
      );
      if (q) {
        processedRef.current.push(q.timestamp);
        questionPauseTimeRef.current = t;
        pauseMedia();
        setCurrentQuestion(q);
        setQuestionPhase("answering");
        setHintUsed(false);
        setFeedback(null);
      }
    }, 200);
  }, [getCurrentTime, pauseMedia, stopPolling]);

  // --- Account loading ---
  const loadAccountData = useCallback(async (activeSession?: AuthSession | null) => {
    const hasProfile = await backendHasPath("/profile");
    const [profileResult, historyResult] = await Promise.allSettled([
      hasProfile
        ? apiFetch<{ username: string; settings: UserSettings }>("/profile")
        : Promise.reject(new Error("Not Found")),
      getStoredHistory(),
    ]);

    if (profileResult.status === "fulfilled") {
      setUsername(profileResult.value.username || "friend");
      setSettings(mergeSettings(profileResult.value.settings));
    } else if (!isRecoverableError(profileResult.reason)) {
      throw profileResult.reason;
    } else {
      setUsername(activeSession?.user.username || "friend");
      setSettings(defaultSettings);
    }

    if (historyResult.status === "fulfilled") {
      setHistory(historyResult.value);
    } else if (!isRecoverableError(historyResult.reason)) {
      throw historyResult.reason;
    }
  }, []);

  const saveProfileSafely = useCallback(async (payload: { username?: string; settings?: UserSettings }) => {
    const hasProfile = await backendHasPath("/profile");
    if (!hasProfile) return;
    try {
      await apiFetch("/profile", { method: "PUT", body: JSON.stringify(payload) });
    } catch (e) {
      if (!isRecoverableError(e)) throw e;
    }
  }, []);

  // --- Video complete ---
  const handleVideoComplete = useCallback(async () => {
    if (hasRecordedCompletionRef.current || !videoId) return;
    hasRecordedCompletionRef.current = true;
    try {
      const nextHistory = await saveScoreRecord({
        videoId,
        videoName: videoTitleRef.current || `Media ${videoId}`,
        completedAt: new Date().toISOString(),
        score: scoreRef.current,
        totalQuestions: questionsRef.current.length,
      });
      setVideoTitle(videoTitleRef.current);
      setHistory(nextHistory);
    } catch (err) {
      console.error("Failed to save session:", err);
    }
  }, [videoId]);

  // --- Init ---
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
    ensureValidSession().then(async (s) => { setSession(s); if (s) await loadAccountData(s); }).finally(() => setAuthReady(true));
  }, [loadAccountData]);

  useEffect(() => {
    window.addEventListener("pointermove", (e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; });
  }, []);

  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { videoTitleRef.current = videoTitle; }, [videoTitle]);
  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
    setBlankAnswers(
      currentQuestion?.kind === "fill-in-the-blanks"
        ? currentQuestion.blanks.map(() => "")
        : []
    );
  }, [currentQuestion]);

  useEffect(() => {
    if (authReady && session) {
      const id = window.setTimeout(() => {
        saveProfileSafely({ username, settings }).catch(console.error);
      }, 250);
      return () => window.clearTimeout(id);
    }
  }, [authReady, username, settings, saveProfileSafely]);

  useEffect(() => {
    return () => {
      if (hintReplayTimeoutRef.current) window.clearTimeout(hintReplayTimeoutRef.current);
      if (resolveTimeoutRef.current) window.clearTimeout(resolveTimeoutRef.current);
      if (confettiTimeoutRef.current) window.clearTimeout(confettiTimeoutRef.current);
    };
  }, []);

  // --- YouTube player ---
  useEffect(() => {
    if (!videoId || mediaKind !== "youtube" || !window.YT) return;
    const yt = window.YT;
    destroyMedia();
    playerRef.current = new yt.Player("yt-player", {
      height: "100%", width: "100%", videoId,
      playerVars: { autoplay: 1, origin: window.location.origin },
      events: {
        onReady: () => {
          setVideoTitle(playerRef.current?.getVideoData?.().title ?? "");
          playMedia();
          startPolling();
        },
        onStateChange: (e) => {
          if (e.data === yt.PlayerState.PLAYING) {
            setVideoTitle(playerRef.current?.getVideoData?.().title ?? "Current video");
            if (!hintReplayActiveRef.current) startPolling();
            return;
          }
          stopPolling();
          if (e.data === yt.PlayerState.ENDED) void handleVideoComplete();
        },
      },
    });
    return () => stopPolling();
  }, [destroyMedia, handleVideoComplete, mediaKind, playMedia, startPolling, stopPolling, videoId]);

  // --- Uploaded media ---
  useEffect(() => {
    if (!videoId || mediaKind === "youtube") return;
    const el = mediaElementRef.current;
    if (!el) return;
    el.addEventListener("play", () => { if (!hintReplayActiveRef.current) startPolling(); });
    el.addEventListener("pause", () => { if (!hintReplayActiveRef.current) stopPolling(); });
    el.addEventListener("ended", () => { stopPolling(); void handleVideoComplete(); });
    el.play().catch(() => undefined);
    startPolling();
    return () => stopPolling();
  }, [handleVideoComplete, mediaKind, startPolling, stopPolling, videoId]);

  // --- Confetti ---
  const launchConfetti = (x: number, y: number) => {
    const pieces = Array.from({ length: 18 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 18;
      const spread = 60 + Math.random() * 50;
      return {
        id: confettiIdRef.current++,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        left: x, top: y,
        size: 7 + Math.random() * 7,
        dx: Math.cos(angle) * spread + (Math.random() - 0.5) * 20,
        dy: -(25 + Math.random() * 80),
        rotation: -180 + Math.random() * 360,
        duration: 800 + Math.random() * 500,
        delay: Math.random() * 80,
      } satisfies ConfettiPiece;
    });
    setConfettiPieces(pieces);
    if (confettiTimeoutRef.current) window.clearTimeout(confettiTimeoutRef.current);
    confettiTimeoutRef.current = window.setTimeout(() => {
      setConfettiPieces([]);
      confettiTimeoutRef.current = null;
    }, 1500);
  };

  // --- Answer handlers ---
  const reportResult = (q: Question, isCorrect: boolean, selected: string) => {
    if (!videoId) return;
    submitQuestionResult(
      videoId, q.timestamp, isCorrect,
      getQuestionPrompt(q), selected, formatQuestionAnswer(q),
      q.word, q.phoneticCategory
    ).catch(console.error);
  };

  const scheduleContinue = () => {
    if (resolveTimeoutRef.current) window.clearTimeout(resolveTimeoutRef.current);
    resolveTimeoutRef.current = window.setTimeout(() => {
      resolveTimeoutRef.current = null;
      continueVideo();
    }, 1200);
  };

  const handleAnswerClick = (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!currentQuestion || currentQuestion.kind !== "multiple-choice") return;
    const q = currentQuestion as MultipleChoiceQuestion;
    const isCorrect = index === q.answerIndex;
    const selected = q.choices[index];
    setAnsweredCount((p) => p + 1);

    if (isCorrect) {
      const rect = event.currentTarget.getBoundingClientRect();
      launchConfetti(pointerRef.current.x || rect.left + rect.width / 2, pointerRef.current.y || rect.top);
      reportResult(q, true, selected);
      setFeedback("Correct!");
      setQuestionPhase("resolved");
      setScore((p) => p + 1);
      scheduleContinue();
      return;
    }
    if (!hintUsed) {
      setFeedback("Not quite. Use Hint to replay the last 5 seconds, then try once more.");
      setQuestionPhase("awaiting-hint");
      setAnsweredCount((p) => p - 1); // don't count hint attempt
      return;
    }
    reportResult(q, false, selected);
    setFeedback(`Incorrect. Answer: ${q.choices[q.answerIndex]}`);
    setQuestionPhase("resolved");
    scheduleContinue();
  };

  const handleBlankSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentQuestion || currentQuestion.kind !== "fill-in-the-blanks") return;
    if (questionPhase === "awaiting-hint" || questionPhase === "replaying-hint" || questionPhase === "resolved") return;
    const q = currentQuestion as FillInTheBlanksQuestion;
    const userAnswers = blankAnswers.map(normalizeBlankAnswer);
    if (userAnswers.some((a) => !a)) { setFeedback("Fill in every blank before submitting."); return; }
    const correct = q.blanks.map(normalizeBlankAnswer);
    const isCorrect = userAnswers.every((a, i) => a === correct[i]);
    const selected = blankAnswers.join(", ");
    setAnsweredCount((p) => p + 1);

    if (isCorrect) {
      reportResult(q, true, selected);
      setFeedback("Correct! Every blank filled perfectly.");
      setQuestionPhase("resolved");
      setScore((p) => p + 1);
      scheduleContinue();
      return;
    }
    if (!hintUsed) {
      setFeedback("Not quite. Use Hint to replay the sentence, then try again.");
      setQuestionPhase("awaiting-hint");
      setAnsweredCount((p) => p - 1);
      return;
    }
    reportResult(q, false, selected);
    setFeedback(`The missing word${q.blanks.length > 1 ? "s were" : " was"}: ${q.blanks.join(", ")}`);
    setQuestionPhase("resolved");
    scheduleContinue();
  };

  const handleHintClick = () => {
    if (!currentQuestionRef.current || hintUsed) return;
    const t = getCurrentTime() ?? questionPauseTimeRef.current ?? currentQuestionRef.current.timestamp;
    const rewind = Math.max(0, t - 5);
    const stop = questionPauseTimeRef.current ?? t;
    const dur = Math.max(250, Math.round((stop - rewind) * 1000));
    setHintUsed(true);
    setQuestionPhase("replaying-hint");
    setFeedback("Replaying the last 5 seconds…");
    hintReplayActiveRef.current = true;
    if (hintReplayTimeoutRef.current) window.clearTimeout(hintReplayTimeoutRef.current);
    seekMedia(rewind);
    playMedia();
    startPolling();
    hintReplayTimeoutRef.current = window.setTimeout(() => {
      hintReplayTimeoutRef.current = null;
      hintReplayActiveRef.current = false;
      pauseMedia();
      setQuestionPhase("second-attempt");
      setFeedback("Replay complete. Choose your answer.");
    }, dur);
  };

  const continueVideo = () => {
    if (hintReplayTimeoutRef.current) { window.clearTimeout(hintReplayTimeoutRef.current); hintReplayTimeoutRef.current = null; }
    if (resolveTimeoutRef.current) { window.clearTimeout(resolveTimeoutRef.current); resolveTimeoutRef.current = null; }
    setCurrentQuestion(null);
    setBlankAnswers([]);
    setFeedback(null);
    setQuestionPhase("answering");
    setHintUsed(false);
    hintReplayActiveRef.current = false;
    questionPauseTimeRef.current = null;
    playMedia();
    startPolling();
  };

  // --- Load video / upload ---
  const waitForQuestions = async (jobId: string) => {
    while (true) {
      const job: QuestionsJob = await getQuestionsJob(jobId);
      setGenerationProgress(job.progress);
      setGenerationStage(job.stage);
      if (job.status === "completed") return job.questions ?? [];
      if (job.status === "failed") throw new Error(job.error ?? "Generation failed");
      await new Promise((r) => window.setTimeout(r, POLL_INTERVAL_MS));
    }
  };

  const resetSession = () => {
    stopPolling();
    destroyMedia();
    processedRef.current = [];
    questionsRef.current = [];
    hasRecordedCompletionRef.current = false;
    setCurrentQuestion(null);
    setBlankAnswers([]);
    setFeedback(null);
    setQuestionPhase("answering");
    setHintUsed(false);
    questionPauseTimeRef.current = null;
    hintReplayActiveRef.current = false;
    setScore(0);
    setAnsweredCount(0);
    setVideoTitle("");
    setVideoId("");
    setPendingVideoId("");
    setLoadError(null);
    setGenerationStage("Queued");
    setGenerationProgress(0);
    setActivePage("dashboard");
    setIsNavOpen(false);
  };

  const ACCEPTED_TYPES = new Set(["audio/mpeg", "audio/mp3", "video/mp4", "audio/wav", "audio/m4a", "audio/aac", "audio/ogg", "audio/flac", "video/quicktime", "video/webm", "video/mpeg"]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (ACCEPTED_TYPES.has(file.type) || file.type.startsWith("audio/") || file.type.startsWith("video/"))) {
      setSelectedFile(file);
      setUrlInput("");
    }
  };

  const handleLoadVideo = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextVideoId = extractVideoId(urlInput);
    const nextFile = selectedFile;
    if (!nextFile && !nextVideoId) { setLoadError("Enter a valid YouTube URL or choose a media file."); return; }
    resetSession();
    setLoading(true);
    try {
      let jobId = "";
      let nextMediaId = "";
      let nextMediaKind: MediaKind = "youtube";

      if (nextFile) {
        const result = await createUploadQuestionsJob(nextFile, settings);
        jobId = result.jobId;
        nextMediaId = result.mediaId;
        nextMediaKind = nextFile.type.startsWith("audio/") ? "audio-upload" : "video-upload";
        const objectUrl = URL.createObjectURL(nextFile);
        setUploadedMedia({ id: result.mediaId, kind: nextMediaKind, file: nextFile, objectUrl, title: result.title });
      } else {
        jobId = await createQuestionsJob(urlInput, settings);
        nextMediaId = nextVideoId;
        nextMediaKind = "youtube";
        setUploadedMedia(null);
      }

      const questions = await waitForQuestions(jobId);
      questionsRef.current = questions;
      setGenerationProgress(100);
      setGenerationStage("Complete");
      setPendingVideoId("");
      setMediaKind(nextMediaKind);
      setVideoId(nextMediaId);
    } catch (error) {
      setPendingVideoId("");
      setLoadError(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  // --- Auth handlers ---
  const handleSignIn = async (email: string, password: string) => {
    const s = await signInWithEmail(email, password);
    setSession(s);
    setUsername(s.user.username);
    await loadAccountData(s);
  };

  const handleSignUp = async (email: string, uname: string, password: string): Promise<SignUpResult> => {
    const result = await signUpWithEmail(email, password, uname);
    if (result.session) {
      setSession(result.session);
      setUsername(uname);
      await saveProfileSafely({ username: uname, settings: defaultSettings });
      await loadAccountData(result.session);
    }
    return result;
  };

  const handleSignOut = () => {
    signOut();
    setSession(null);
    setHistory([]);
    setUsername("friend");
    setSettings(defaultSettings);
    setAuthView("landing");
    resetSession();
  };

  const handleClearHistory = () => {
    clearStoredHistory().then(() => setHistory([])).catch(console.error);
  };

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const records = await getStoredHistory();
      setHistory(records);
    } catch (e) {
      console.error("Failed to refresh history:", e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const currentAccuracy = answeredCount ? Math.round((score / answeredCount) * 100) : 0;
  const plantStage = Math.min(10, Math.floor(currentAccuracy / 10));

  // --- Auth gates ---
  if (!authReady) {
    return <div className="min-h-screen bg-[#F4F6FA]" />;
  }

  if (!session) {
    return (
      <AuthPanel
        onSignIn={handleSignIn}
        onSignUp={handleSignUp}
        initialMode={authView === "signup" ? "signup" : "signin"}
      />
    );
  }

  // --- Main app ---
  return (
    <div className="min-h-screen bg-[#F4F6FA] font-sans text-[#1C1B18]">

      {/* Confetti overlay */}
      <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
        {confettiPieces.map((p) => (
          <span
            key={p.id}
            className="absolute rounded-sm"
            style={{
              left: p.left, top: p.top,
              width: p.size, height: p.size * 0.6,
              backgroundColor: p.color,
              transform: "translate(-50%,-50%)",
              animation: `confettiBurst ${p.duration}ms ease-out ${p.delay}ms forwards`,
              ["--cx" as string]: `${p.dx}px`,
              ["--cy" as string]: `${p.dy}px`,
              ["--cr" as string]: `${p.rotation}deg`,
              opacity: 0,
            }}
          />
        ))}
      </div>

      {/* Plant growth widget */}
      {activePage === "dashboard" && (
        <div className="fixed bottom-5 right-5 z-[60]">
          {plantMinimized ? (
            <button
              onClick={() => setPlantMinimized(false)}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-[#E2E0DB] bg-white shadow-sm transition-colors hover:bg-[#F4F6FA]"
              title="Open growth buddy"
            >
              <span className="text-xl">🪴</span>
            </button>
          ) : (
            <div className="w-64 overflow-hidden rounded-2xl border border-[#E2E0DB] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#E2E0DB] px-4 py-3">
                <p className="text-sm font-bold text-[#1C1B18]">Growth buddy 🪴</p>
                <button
                  onClick={() => setPlantMinimized(true)}
                  className="p-1 text-[#B8B5AF] transition-colors hover:text-[#1C1B18]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M4 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 10Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-[#7A7570]">Accuracy this session</span>
                  <span className="font-semibold text-[#1C1B18]">{currentAccuracy}%</span>
                </div>
                {/* Plant visual */}
                <div className="relative h-28 overflow-hidden rounded-xl bg-[#F0FFF6]">
                  {/* Ground */}
                  <div className="absolute bottom-0 left-0 right-0 h-8 rounded-b-xl bg-[#2D6A4F]/20" />
                  {/* Pot */}
                  <div className="absolute bottom-5 left-1/2 h-8 w-12 -translate-x-1/2 rounded-sm bg-[#8B5E3C]/70" />
                  {/* Stem */}
                  {plantStage > 0 && (
                    <div
                      className="absolute left-1/2 -translate-x-px rounded-full bg-[#2D6A4F] transition-all duration-700"
                      style={{ bottom: "52px", width: "3px", height: `${plantStage * 8}px` }}
                    />
                  )}
                  {/* Leaves */}
                  {plantStage >= 2 && (
                    <div
                      className="absolute h-4 w-7 rounded-full bg-[#52B788]"
                      style={{ bottom: `${52 + plantStage * 4}px`, left: "calc(50% - 26px)", transform: "rotate(-25deg)" }}
                    />
                  )}
                  {plantStage >= 4 && (
                    <div
                      className="absolute h-4 w-7 rounded-full bg-[#52B788]"
                      style={{ bottom: `${52 + plantStage * 5}px`, left: "calc(50% + 2px)", transform: "rotate(25deg)" }}
                    />
                  )}
                  {plantStage >= 7 && (
                    <div
                      className="absolute left-1/2 h-5 w-5 -translate-x-1/2 rounded-full bg-[#FFB830]"
                      style={{ bottom: `${52 + plantStage * 8}px` }}
                    />
                  )}
                  <p className="absolute bottom-1 right-2 text-xs text-[#2D6A4F]/60">
                    stage {plantStage}/10
                  </p>
                </div>
                <p className="mt-2 text-xs text-[#B8B5AF]">
                  {answeredCount === 0
                    ? "Answer questions to grow your plant."
                    : `${score} correct of ${answeredCount} answered.`}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hamburger */}
      <button
        onClick={() => setIsNavOpen(true)}
        className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[#E2E0DB] bg-white shadow-sm transition-colors hover:bg-[#F4F6FA]"
        aria-label="Open navigation"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {/* Overlay */}
      {isNavOpen && (
        <button onClick={() => setIsNavOpen(false)} className="fixed inset-0 z-40 bg-black/20" aria-label="Close navigation" />
      )}

      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-[#1C1B18] px-5 py-7 text-white shadow-2xl transition-transform duration-300 ${isNavOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between">
          <span className="font-display text-xl italic text-white">echoLearn</span>
          <button onClick={() => setIsNavOpen(false)} className="p-1.5 text-white/30 transition-colors hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {username && (
          <p className="mt-4 text-sm text-white/40">
            Hello, <span className="text-white/70">{username}</span>
          </p>
        )}

        <nav className="mt-8 flex flex-col gap-0.5">
          <NavButton label="Dashboard" active={activePage === "dashboard"} onClick={() => { setActivePage("dashboard"); setIsNavOpen(false); }} />
          <NavButton label="Statistics" active={activePage === "statistics"} onClick={() => { setActivePage("statistics"); setIsNavOpen(false); refreshHistory(); }} />
          <NavButton label="Past Attempts" active={activePage === "past-attempts"} onClick={() => { setActivePage("past-attempts"); setIsNavOpen(false); }} />
        </nav>

        <div className="mt-auto">
          <div className="mb-4">
            <span className="block text-4xl font-bold text-white">{history.length}</span>
            <span className="text-sm text-white/40">saved {history.length === 1 ? "session" : "sessions"}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full rounded-lg border border-white/10 px-3 py-2.5 text-left text-sm font-medium text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentSettings={settings}
        onSave={(s) => setSettings(s)}
      />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#E2E0DB] px-20 py-4">
        <h1 className="text-base font-bold text-[#1C1B18]">
          {activePage === "dashboard" ? "Interactive Quiz" : activePage === "statistics" ? "Performance" : "Past Attempts"}
        </h1>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="rounded-md p-2 text-[#7A7570] transition-colors hover:bg-[#EEECEA] hover:text-[#1C1B18]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </header>

      {activePage === "dashboard" ? (
        <>
          {/* URL / Upload bar */}
          <div className="border-b border-[#E2E0DB] px-6 py-3">
            <form onSubmit={handleLoadVideo} className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
              <input
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); if (e.target.value) setSelectedFile(null); }}
                placeholder="https://www.youtube.com/watch?v=…"
                className="w-full max-w-sm rounded-lg border border-[#E2E0DB] bg-white px-4 py-2.5 text-sm text-[#1C1B18] placeholder-[#B8B5AF] focus:border-[#3A6EAE] focus:outline-none focus:ring-2 focus:ring-[#3A6EAE]/20"
              />

              <span className="text-xs text-[#B8B5AF]">or</span>

              {/* Drop zone */}
              <label
                className={`relative flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors ${
                  selectedFile
                    ? "border-[#3A6EAE]/40 bg-[#EEF4FF] text-[#3A6EAE]"
                    : isDragOver
                    ? "border-[#3A6EAE] bg-[#EEF4FF] text-[#3A6EAE]"
                    : "border-dashed border-[#D4D2CC] bg-white text-[#7A7570] hover:border-[#3A6EAE] hover:text-[#3A6EAE]"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
              >
                {selectedFile ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
                      <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v10.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25V8.75A1.75 1.75 0 0 0 16.25 7h-4.836a.25.25 0 0 1-.177-.073L9.823 5.513A1.75 1.75 0 0 0 8.586 5H3.75Z" />
                    </svg>
                    <span className="max-w-[180px] truncate font-medium">{selectedFile.name}</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
                      <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v9.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd" />
                      <path fillRule="evenodd" d="M3 17.25a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                    </svg>
                    <span>{isDragOver ? "Drop it!" : "Drop MP3 / MP4 or click"}</span>
                  </>
                )}
                <input
                  type="file"
                  accept=".mp3,.mp4,.wav,.m4a,.aac,.ogg,.flac,.mov,.webm,audio/*,video/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; setSelectedFile(f); if (f) setUrlInput(""); }}
                />
              </label>

              {selectedFile && (
                <button type="button" onClick={() => setSelectedFile(null)} className="text-xs text-[#B8B5AF] hover:text-[#C13030]" title="Remove file">
                  ✕
                </button>
              )}

              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-[#3A6EAE] px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-[#2C5A93] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Generating…" : "Load"}
              </button>
              {loadError && <p className="text-sm font-medium text-[#C13030]">{loadError}</p>}
            </form>
          </div>

          <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-12 lg:items-start">
            {/* Video column */}
            <div className="flex flex-col lg:col-span-8">
              <div className="rounded-2xl border border-[#E2E0DB] bg-white p-5 shadow-sm">
                {loading ? (
                  <GenerationPanel progress={generationProgress} stage={generationStage} />
                ) : videoId ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-bold text-[#1C1B18]">{videoTitle || "Loading…"}</h2>
                      <span className={`text-sm font-bold transition-colors ${answeredCount > 0 ? "text-[#3A6EAE]" : "text-[#B8B5AF]"}`}>
                        Score: {score} / {answeredCount || "—"}
                      </span>
                    </div>
                    {mediaKind === "youtube" ? (
                      <div className="relative aspect-video overflow-hidden rounded-xl border border-[#E2E0DB] bg-black">
                        <div id="yt-player" className="absolute inset-0" />
                      </div>
                    ) : mediaKind === "audio-upload" ? (
                      <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-xl border border-[#E2E0DB] bg-[#F4F6FA]">
                        <p className="font-medium text-[#1C1B18]">{uploadedMedia?.title}</p>
                        <audio
                          ref={(el) => { mediaElementRef.current = el; }}
                          src={uploadedMedia?.objectUrl}
                          controls
                          className="w-full max-w-sm"
                        />
                      </div>
                    ) : (
                      <div className="relative aspect-video overflow-hidden rounded-xl border border-[#E2E0DB] bg-black">
                        <video
                          ref={(el) => { mediaElementRef.current = el; }}
                          src={uploadedMedia?.objectUrl}
                          controls
                          className="absolute inset-0 h-full w-full"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#D4D2CC] bg-[#F4F6FA]">
                    {pendingVideoId ? (
                      <p className="text-sm text-[#B8B5AF]">Preparing video…</p>
                    ) : (
                      <>
                        <p className="font-display text-3xl italic text-[#C8CDD6]">paste a link. start listening.</p>
                        <p className="text-sm text-[#D4D2CC]">Questions appear at the right moments.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
              {!loading && videoId && (
                <p className="mt-3 text-sm text-[#7A7570]">
                  Questions appear automatically. Finishing the video saves your session.
                </p>
              )}
            </div>

            {/* Quiz column */}
            <div className="flex w-full flex-col lg:col-span-4">
              <div className="mb-4">
                <h2 className="text-xl font-bold text-[#1C1B18]">Quiz</h2>
                <p className="mt-0.5 text-sm text-[#7A7570]">Answer questions as they appear.</p>
              </div>

              <div className={`flex min-h-[220px] flex-col rounded-2xl border bg-white p-6 shadow-sm transition-all ${currentQuestion ? "border-t-[3px] border-t-[#3A6EAE] border-x-[#E2E0DB] border-b-[#E2E0DB]" : "border-[#E2E0DB]"}`}>
                {currentQuestion ? (
                  <div className="flex flex-col gap-4">
                    <h3 className="mb-2 text-center font-display text-xl italic leading-snug text-[#1C1B18]">
                      {getQuestionPrompt(currentQuestion)}
                    </h3>

                    {questionPhase === "resolved" ? (
                      <div className="flex flex-col gap-2">
                        <p className={`mb-1 text-center text-sm font-semibold ${feedback?.startsWith("Correct") ? "text-[#2D6A4F]" : "text-[#C13030]"}`}>
                          {feedback}
                        </p>
                        {currentQuestion.kind === "multiple-choice" &&
                          currentQuestion.choices.map((choice, i) => {
                            const isCorrect = i === currentQuestion.answerIndex;
                            return (
                              <div key={i} className={`rounded-lg border px-4 py-2.5 text-sm font-medium ${isCorrect ? "border-[#2D6A4F] bg-[#F0FFF6] text-[#1A4833]" : "border-[#E2E0DB] bg-white text-[#B8B5AF]"}`}>
                                {choice}
                              </div>
                            );
                          })}
                        {currentQuestion.kind === "fill-in-the-blanks" && (
                          <p className="text-center text-sm text-[#7A7570]">
                            Answer: <span className="font-semibold text-[#1C1B18]">{currentQuestion.blanks.join(", ")}</span>
                          </p>
                        )}
                        <p className="mt-1 text-center text-xs text-[#B8B5AF]">Moving on…</p>
                      </div>
                    ) : currentQuestion.kind === "multiple-choice" ? (
                      <div className="flex flex-col gap-2">
                        {feedback && (
                          <p className={`mb-1 text-center text-sm font-medium ${questionPhase === "awaiting-hint" ? "text-[#2C5A93]" : "text-[#7A7570]"}`}>
                            {feedback}
                          </p>
                        )}
                        {currentQuestion.choices.map((choice, i) => (
                          <button
                            key={i}
                            onClick={(e) => handleAnswerClick(i, e)}
                            disabled={questionPhase === "awaiting-hint" || questionPhase === "replaying-hint"}
                            className="w-full rounded-lg border border-[#E2E0DB] bg-white px-4 py-2.5 text-left text-sm font-medium text-[#1C1B18] transition-all hover:border-[#3A6EAE] hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {choice}
                          </button>
                        ))}
                        <HintRow hintUsed={hintUsed} questionPhase={questionPhase} onHint={handleHintClick} />
                      </div>
                    ) : (
                      /* Fill-in-the-blanks */
                      <form onSubmit={handleBlankSubmit} className="flex flex-col gap-3">
                        {feedback && (
                          <p className={`text-center text-sm font-medium ${questionPhase === "awaiting-hint" ? "text-[#2C5A93]" : "text-[#7A7570]"}`}>
                            {feedback}
                          </p>
                        )}
                        <p className="text-sm text-[#7A7570]">
                          {currentQuestion.sentenceWithBlanks.split("___").map((part, i, arr) => (
                            <span key={i}>
                              {part}
                              {i < arr.length - 1 && (
                                <input
                                  value={blankAnswers[i] ?? ""}
                                  onChange={(e) => setBlankAnswers((prev) => prev.map((v, idx) => idx === i ? e.target.value : v))}
                                  disabled={questionPhase === "awaiting-hint" || questionPhase === "replaying-hint"}
                                  className="mx-1 inline-block w-24 rounded border border-[#E2E0DB] px-2 py-0.5 text-sm text-[#1C1B18] focus:border-[#3A6EAE] focus:outline-none"
                                  placeholder="…"
                                />
                              )}
                            </span>
                          ))}
                        </p>
                        <button
                          type="submit"
                          disabled={questionPhase === "awaiting-hint" || questionPhase === "replaying-hint"}
                          className="rounded-lg bg-[#3A6EAE] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2C5A93] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Submit
                        </button>
                        <HintRow hintUsed={hintUsed} questionPhase={questionPhase} onHint={handleHintClick} />
                      </form>
                    )}
                  </div>
                ) : (
                  <p className="my-auto text-center text-sm text-[#B8B5AF]">
                    {loading
                      ? `${generationStage} (${generationProgress}%)`
                      : videoId
                      ? "Play the video to start"
                      : "Questions will appear here during playback"}
                  </p>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-[#E2E0DB] bg-white p-5 shadow-sm">
                <p className="mb-4 text-sm font-bold text-[#1C1B18]">Session</p>
                <div className="grid grid-cols-2 gap-3">
                  <SnapshotCard label="Accuracy" value={answeredCount > 0 ? `${currentAccuracy}% (${score}/${answeredCount})` : "—"} />
                  <SnapshotCard label="Sessions" value={`${history.length}`} />
                </div>
              </div>
            </div>
          </main>
        </>
      ) : activePage === "statistics" ? (
        <main className="mx-auto max-w-[1600px] px-6 py-8">
          <StatisticsPage history={history} onClearHistory={handleClearHistory} onRefresh={refreshHistory} isLoading={historyLoading} />
        </main>
      ) : (
        <main className="mx-auto max-w-[1600px] px-6 py-8">
          <PastAttemptsPage history={history} />
        </main>
      )}
    </div>
  );
}

function extractVideoId(input: string) {
  try {
    const parsed = new URL(input);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "").slice(0, 11);
    const id = parsed.searchParams.get("v");
    if (id) return id.slice(0, 11);
    const m = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    return m?.[1] ?? "";
  } catch {
    return input.match(/([a-zA-Z0-9_-]{11})/)?.[1] ?? "";
  }
}

function GenerationPanel({ progress, stage }: { progress: number; stage: string }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[#1C1B18] text-white">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-widest text-white/30">Generating quiz</p>
          <p className="font-display text-2xl italic text-white">{stage}</p>
        </div>
        <div className="w-full max-w-sm">
          <div className="h-px bg-white/10">
            <div className="h-px bg-[#3A6EAE] transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-right text-xs text-white/25">{progress}%</p>
        </div>
      </div>
    </div>
  );
}

function HintRow({ hintUsed, questionPhase, onHint }: { hintUsed: boolean; questionPhase: string; onHint: () => void }) {
  return (
    <div className="mt-2 flex items-center justify-between">
      <p className="text-xs text-[#B8B5AF]">
        {questionPhase === "replaying-hint" ? "Replaying…" : hintUsed ? "Hint used" : "Need a hint?"}
      </p>
      <button
        type="button"
        onClick={onHint}
        disabled={hintUsed || questionPhase === "replaying-hint"}
        className="flex items-center gap-1.5 rounded-md border border-[#E2E0DB] px-3 py-1.5 text-xs font-semibold text-[#7A7570] transition-colors hover:border-[#3A6EAE] hover:text-[#3A6EAE] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" />
        </svg>
        Replay 5s
      </button>
    </div>
  );
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all ${active ? "bg-[#3A6EAE] text-white" : "text-white/50 hover:bg-white/5 hover:text-white"}`}
    >
      {label}
    </button>
  );
}

function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E2E0DB] bg-[#F4F6FA] p-3">
      <p className="text-xs text-[#7A7570]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#1C1B18]">{value}</p>
    </div>
  );
}
