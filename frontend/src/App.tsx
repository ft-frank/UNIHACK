import { useCallback, useEffect, useRef, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import Settings, { type UserSettings } from "./components/settings";
import StatisticsPage from "./components/StatisticsPage";
import PastAttemptsPage from "./components/PastAttemptsPage";
import heroImage from "./assets/hero.png";
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
import type { Question, QuestionsJob } from "./questions";
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
  Player: new (
    elementId: string,
    config: {
      height: string;
      width: string;
      videoId: string;
      playerVars: { autoplay: number; origin: string };
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    PLAYING: number;
    ENDED: number;
  };
};

const POLL_INTERVAL_MS = 1500;
const CONFETTI_COLORS = [
  "#f97316",
  "#facc15",
  "#22c55e",
  "#38bdf8",
  "#f472b6",
  "#a78bfa",
];
const PLANT_ICON_SIZE = 56;
const PLANT_PANEL_MAX_WIDTH = 290;
const PLANT_WIDGET_MARGIN = 8;
const PLANT_WIDGET_TOP_OFFSET = 88;
const PLANT_PANEL_FALLBACK_HEIGHT = 420;

type ConfettiPiece = {
  id: number;
  color: string;
  left: number;
  top: number;
  size: number;
  dx: number;
  dy: number;
  rotation: number;
  duration: number;
  delay: number;
};

type MediaKind = "youtube" | "audio-upload" | "video-upload";

type UploadedMedia = {
  id: string;
  kind: MediaKind;
  file: File;
  objectUrl: string;
  title: string;
};

const getTimeOfDayGreeting = (date: Date) => {
  const hour = date.getHours();

  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
};

const defaultSettings: UserSettings = {
  type: "Cochlear",
  difficulty: "Beginner",
  frequency: "3-5",
  cochlearAssessmentMode: "multiple-choice",
  specificGroups: "",
  specificSounds: "",
};

const mergeSettings = (incoming?: Partial<UserSettings> | null): UserSettings => ({
  ...defaultSettings,
  ...(incoming ?? {}),
});

const isNotFoundError = (error: unknown) =>
  error instanceof Error && error.message === "Not Found";

const isRecoverableAccountDataError = (error: unknown) =>
  isNotFoundError(error) ||
  (error instanceof TypeError && error.message === "Failed to fetch");

const normalizeBlankAnswer = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatQuestionAnswer = (question: Question) =>
  question.kind === "fill-in-the-blanks"
    ? question.blanks.join(", ")
    : question.choices[question.answerIndex];

const getQuestionPrompt = (question: Question) =>
  question.kind === "fill-in-the-blanks"
    ? question.promptSentence || question.sentenceWithBlanks
    : question.question;

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authView, setAuthView] = useState<"landing" | "signin" | "signup">("landing");
  const [activePage, setActivePage] = useState<"dashboard" | "statistics" | "past-attempts">(
    "dashboard"
  );
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const [username, setUsername] = useState("friend");
  const [timeOfDayGreeting, setTimeOfDayGreeting] = useState(() =>
    getTimeOfDayGreeting(new Date())
  );
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isPlantWidgetMinimized, setIsPlantWidgetMinimized] = useState(true);
  const [plantWidgetPosition, setPlantWidgetPosition] = useState({ x: 0, y: 180 });
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);

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
  const pointerPositionRef = useRef({ x: 0, y: 0 });
  const confettiIdRef = useRef(0);
  const draggingPlantIconRef = useRef(false);
  const plantDragOffsetRef = useRef({ x: 0, y: 0 });
  const plantWidgetRef = useRef<HTMLDivElement | null>(null);

  const getPlantPanelBounds = useCallback(() => {
    const panelWidth =
      plantWidgetRef.current?.offsetWidth ??
      Math.min(PLANT_PANEL_MAX_WIDTH, window.innerWidth - PLANT_WIDGET_MARGIN * 2);
    const panelHeight =
      plantWidgetRef.current?.offsetHeight ?? PLANT_PANEL_FALLBACK_HEIGHT;

    return {
      minX: PLANT_WIDGET_MARGIN,
      maxX: Math.max(window.innerWidth - panelWidth - PLANT_WIDGET_MARGIN, PLANT_WIDGET_MARGIN),
      minY: PLANT_WIDGET_TOP_OFFSET,
      maxY: Math.max(
        window.innerHeight - panelHeight - PLANT_WIDGET_MARGIN,
        PLANT_WIDGET_TOP_OFFSET
      ),
    };
  }, []);

  const clampPlantIconPosition = useCallback((x: number, y: number) => ({
    x: Math.min(
      Math.max(x, PLANT_WIDGET_MARGIN),
      Math.max(window.innerWidth - PLANT_ICON_SIZE - PLANT_WIDGET_MARGIN, PLANT_WIDGET_MARGIN)
    ),
    y: Math.min(
      Math.max(y, PLANT_WIDGET_TOP_OFFSET),
      Math.max(window.innerHeight - PLANT_ICON_SIZE - PLANT_WIDGET_MARGIN, PLANT_WIDGET_TOP_OFFSET)
    ),
  }), []);

  const clampPlantPanelPosition = useCallback(
    (x: number, y: number) => {
      const bounds = getPlantPanelBounds();
      return {
        x: Math.min(Math.max(x, bounds.minX), bounds.maxX),
        y: Math.min(Math.max(y, bounds.minY), bounds.maxY),
      };
    },
    [getPlantPanelBounds]
  );

  const loadAccountData = useCallback(async (activeSession?: AuthSession | null) => {
    const hasProfilePath = await backendHasPath("/profile");
    const [profileResult, historyResult] = await Promise.allSettled([
      hasProfilePath
        ? apiFetch<{
            username: string;
            theme: string;
            settings: UserSettings;
          }>("/profile")
        : Promise.reject(new Error("Not Found")),
      getStoredHistory(),
    ]);

    if (profileResult.status === "fulfilled") {
      setUsername(profileResult.value.username || "friend");
      setIsDarkMode(profileResult.value.theme === "dark");
      setSettings(mergeSettings(profileResult.value.settings));
    } else if (!isRecoverableAccountDataError(profileResult.reason)) {
      throw profileResult.reason;
    } else {
      setUsername(activeSession?.user.username || "friend");
      setIsDarkMode(false);
      setSettings(defaultSettings);
    }

    if (historyResult.status === "fulfilled") {
      setHistory(historyResult.value);
    } else if (!isRecoverableAccountDataError(historyResult.reason)) {
      throw historyResult.reason;
    } else {
      setHistory([]);
    }
  }, []);

  const saveProfileSafely = useCallback(async (payload: {
    username?: string;
    theme?: string;
    settings?: UserSettings;
  }) => {
    const hasProfilePath = await backendHasPath("/profile");
    if (!hasProfilePath) {
      return;
    }

    try {
      await apiFetch("/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!isRecoverableAccountDataError(error)) {
        throw error;
      }
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }
  }, []);

  const getCurrentPlaybackTime = useCallback(() => {
    if (mediaKind === "youtube") {
      return playerRef.current?.getCurrentTime?.() ?? null;
    }

    return mediaElementRef.current?.currentTime ?? null;
  }, [mediaKind]);

  const pauseActiveMedia = useCallback(() => {
    if (mediaKind === "youtube") {
      playerRef.current?.pauseVideo?.();
      return;
    }

    mediaElementRef.current?.pause();
  }, [mediaKind]);

  const playActiveMedia = useCallback(() => {
    if (mediaKind === "youtube") {
      playerRef.current?.playVideo?.();
      return;
    }

    mediaElementRef.current?.play().catch(() => undefined);
  }, [mediaKind]);

  const seekActiveMedia = useCallback((seconds: number) => {
    if (mediaKind === "youtube") {
      playerRef.current?.seekTo?.(seconds, true);
      return;
    }

    if (mediaElementRef.current) {
      mediaElementRef.current.currentTime = seconds;
    }
  }, [mediaKind]);

  const destroyActiveMedia = useCallback(() => {
    if (playerRef.current?.destroy) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    if (mediaElementRef.current) {
      mediaElementRef.current.pause();
      mediaElementRef.current.currentTime = 0;
      mediaElementRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    intervalRef.current = window.setInterval(() => {
      const currentTime = getCurrentPlaybackTime();
      if (currentTime === null) return;
      const currentSecond = Math.floor(currentTime);

      if (hintReplayActiveRef.current) {
        return;
      }

      const question = questionsRef.current.find(
        (entry) =>
          currentSecond >= entry.timestamp &&
          !processedRef.current.includes(entry.timestamp)
      );

      if (question) {
        processedRef.current.push(question.timestamp);
        questionPauseTimeRef.current = currentTime;
        pauseActiveMedia();
        setCurrentQuestion(question);
        setQuestionPhase("answering");
        setHintUsed(false);
        setFeedback(null);
      }
    }, 200);
  }, [getCurrentPlaybackTime, pauseActiveMedia, stopPolling]);

  const handleVideoComplete = useCallback(async () => {
    if (hasRecordedCompletionRef.current || !videoId) return;

    hasRecordedCompletionRef.current = true;

    const nextHistory = await saveScoreRecord({
      videoId,
      videoName: videoTitleRef.current || `Media ${videoId}`,
      completedAt: new Date().toISOString(),
      score: scoreRef.current,
      totalQuestions: questionsRef.current.length,
    });

    setVideoTitle(videoTitleRef.current);
    setHistory(nextHistory);
  }, [videoId]);

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }

    ensureValidSession()
      .then(async (nextSession) => {
        setSession(nextSession);
        if (nextSession) {
          await loadAccountData(nextSession);
        }
      })
      .finally(() => setAuthReady(true));
  }, [loadAccountData]);

  useEffect(() => {
    const updateGreeting = () => {
      setTimeOfDayGreeting(getTimeOfDayGreeting(new Date()));
    };

    updateGreeting();
    const intervalId = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!session || !authReady) return;

    const timeoutId = window.setTimeout(() => {
      saveProfileSafely({
          username,
          theme: isDarkMode ? "dark" : "light",
          settings,
        }).catch(console.error);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [session, authReady, username, isDarkMode, saveProfileSafely, settings]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    const setDefaultPlantPosition = () => {
      setPlantWidgetPosition((current) => {
        if (current.x !== 0 || current.y !== 180) {
          return isPlantWidgetMinimized
            ? clampPlantIconPosition(current.x, current.y)
            : clampPlantPanelPosition(current.x, current.y);
        }

        const defaultPosition = {
          x: Math.max(window.innerWidth - 88, 0),
          y: Math.max(window.innerHeight - 96, PLANT_WIDGET_TOP_OFFSET),
        };

        return isPlantWidgetMinimized
          ? clampPlantIconPosition(defaultPosition.x, defaultPosition.y)
          : clampPlantPanelPosition(defaultPosition.x, defaultPosition.y);
      });
    };

    setDefaultPlantPosition();
    window.addEventListener("resize", setDefaultPlantPosition);
    return () => window.removeEventListener("resize", setDefaultPlantPosition);
  }, [clampPlantIconPosition, clampPlantPanelPosition, isPlantWidgetMinimized]);

  useEffect(() => {
    videoTitleRef.current = videoTitle;
  }, [videoTitle]);

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
    setBlankAnswers(
      currentQuestion?.kind === "fill-in-the-blanks"
        ? currentQuestion.blanks.map(() => "")
        : []
    );
  }, [currentQuestion]);

  useEffect(() => {
    return () => {
      if (uploadedMedia) {
        URL.revokeObjectURL(uploadedMedia.objectUrl);
      }
    };
  }, [uploadedMedia]);

  useEffect(() => {
    return () => {
      if (hintReplayTimeoutRef.current) {
        window.clearTimeout(hintReplayTimeoutRef.current);
      }
      if (resolveTimeoutRef.current) {
        window.clearTimeout(resolveTimeoutRef.current);
      }
      if (confettiTimeoutRef.current) {
        window.clearTimeout(confettiTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updatePointer = (event: PointerEvent) => {
      pointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    window.addEventListener("pointermove", updatePointer);
    return () => window.removeEventListener("pointermove", updatePointer);
  }, []);

  useEffect(() => {
    if (!videoId || mediaKind !== "youtube" || !window.YT) return;
    const yt = window.YT;
    destroyActiveMedia();

    playerRef.current = new yt.Player("yt-player", {
      height: "100%",
      width: "100%",
      videoId,
      playerVars: { autoplay: 1, origin: window.location.origin },
      events: {
        onReady: () => {
          setVideoTitle(playerRef.current?.getVideoData?.().title ?? "");
          playActiveMedia();
          startPolling();
        },
        onStateChange: (event: { data: number }) => {
          if (event.data === yt.PlayerState.PLAYING) {
            setVideoTitle(
              playerRef.current?.getVideoData?.().title ?? "Current video"
            );
            if (hintReplayActiveRef.current) return;
            startPolling();
            return;
          }

          stopPolling();

          if (event.data === yt.PlayerState.ENDED) {
            handleVideoComplete();
          }
        },
      },
    });

    return () => stopPolling();
  }, [destroyActiveMedia, handleVideoComplete, mediaKind, playActiveMedia, startPolling, stopPolling, videoId]);

  useEffect(() => {
    if (!videoId || mediaKind === "youtube") return;

    const element = mediaElementRef.current;
    if (!element) return;

    const handleLoadedMetadata = () => {
      setVideoTitle(uploadedMedia?.title ?? "Uploaded media");
    };

    const handlePlay = () => {
      if (hintReplayActiveRef.current) return;
      startPolling();
    };

    const handlePause = () => {
      if (!hintReplayActiveRef.current) {
        stopPolling();
      }
    };

    const handleEnded = () => {
      stopPolling();
      void handleVideoComplete();
    };

    element.addEventListener("loadedmetadata", handleLoadedMetadata);
    element.addEventListener("play", handlePlay);
    element.addEventListener("pause", handlePause);
    element.addEventListener("ended", handleEnded);

    void element.play().catch(() => undefined);
    startPolling();

    return () => {
      element.removeEventListener("loadedmetadata", handleLoadedMetadata);
      element.removeEventListener("play", handlePlay);
      element.removeEventListener("pause", handlePause);
      element.removeEventListener("ended", handleEnded);
      stopPolling();
    };
  }, [handleVideoComplete, mediaKind, startPolling, stopPolling, uploadedMedia, videoId]);

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

  const resetSessionState = () => {
    stopPolling();
    destroyActiveMedia();

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

  const handleLoadVideo = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextVideoId = extractVideoId(urlInput);
    const nextFile = selectedFile;

    if (!nextFile && !nextVideoId) {
      setLoadError("Enter a valid YouTube URL or choose a media file.");
      return;
    }

    resetSessionState();

    setLoading(true);
    try {
      let jobId = "";
      let nextMediaId = "";
      let nextMediaKind: MediaKind = "youtube";

      if (nextFile) {
        const uploadResult = await createUploadQuestionsJob(nextFile, settings);
        jobId = uploadResult.jobId;
        nextMediaId = uploadResult.mediaId;
        nextMediaKind = nextFile.type.startsWith("audio/") ? "audio-upload" : "video-upload";
        const objectUrl = URL.createObjectURL(nextFile);
        setUploadedMedia((current) => {
          if (current) {
            URL.revokeObjectURL(current.objectUrl);
          }
          return {
            id: uploadResult.mediaId,
            kind: nextMediaKind,
            file: nextFile,
            objectUrl,
            title: uploadResult.title,
          };
        });
      } else {
        jobId = await createQuestionsJob(urlInput, settings);
        nextMediaId = nextVideoId;
        nextMediaKind = "youtube";
        resetUploadedMedia();
      }

      const fetchedData = await waitForQuestions(jobId);
      questionsRef.current = fetchedData;
      setGenerationProgress(100);
      setGenerationStage("Complete");
      setPendingVideoId("");
      setMediaKind(nextMediaKind);
      setVideoId(nextMediaId);
    } catch (error) {
      setPendingVideoId("");
      setLoadError(
        error instanceof Error ? error.message : "Question generation failed"
      );
    } finally {
      setLoading(false);
    }
  };

  const reportQuestionResult = (
    question: Question,
    isCorrect: boolean,
    selectedAnswer: string
  ) => {
    if (!videoId) return;

    submitQuestionResult(
      videoId,
      question.timestamp,
      isCorrect,
      getQuestionPrompt(question),
      selectedAnswer,
      formatQuestionAnswer(question),
      question.word,
      question.phoneticCategory
    ).catch(console.error);
  };

  const resetUploadedMedia = () => {
    setSelectedFile(null);
    setUploadedMedia((current) => {
      if (current) {
        URL.revokeObjectURL(current.objectUrl);
      }
      return null;
    });
  };

  const launchConfetti = (x: number, y: number) => {
    const pieces = Array.from({ length: 22 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 22;
      const spread = 70 + Math.random() * 60;
      return {
        id: confettiIdRef.current++,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        left: x,
        top: y,
        size: 8 + Math.random() * 8,
        dx: Math.cos(angle) * spread + (Math.random() - 0.5) * 22,
        dy: -(30 + Math.random() * 90),
        rotation: -180 + Math.random() * 360,
        duration: 850 + Math.random() * 500,
        delay: Math.random() * 90,
      } satisfies ConfettiPiece;
    });

    setConfettiPieces(pieces);

    if (confettiTimeoutRef.current) {
      window.clearTimeout(confettiTimeoutRef.current);
    }

    confettiTimeoutRef.current = window.setTimeout(() => {
      setConfettiPieces([]);
      confettiTimeoutRef.current = null;
    }, 1500);
  };

  const handleAnswerClick = (
    index: number,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (!currentQuestion || currentQuestion.kind !== "multiple-choice") return;

    const isCorrect = index === currentQuestion.answerIndex;
    const selectedAnswer = currentQuestion.choices[index];

    if (isCorrect) {
      const rect = event.currentTarget.getBoundingClientRect();
      const fallbackX = rect.left + rect.width / 2;
      const fallbackY = rect.top + rect.height / 2;
      const { x, y } = pointerPositionRef.current;
      launchConfetti(x || fallbackX, y || fallbackY);
      reportQuestionResult(currentQuestion, true, selectedAnswer);
      setFeedback("Correct! You nailed it. 🎉");
      setQuestionPhase("resolved");
      setScore((previous) => previous + 1);
      setAnsweredCount((previous) => previous + 1);
      scheduleContinue();
      return;
    }

    if (!hintUsed) {
      setFeedback(
        "Not quite yet. Use Hint to replay the last 5 seconds, then try once more. 🙂"
      );
      setQuestionPhase("awaiting-hint");
      return;
    }

    reportQuestionResult(currentQuestion, false, selectedAnswer);
    setFeedback(
      `Almost there. The answer was ${currentQuestion.choices[currentQuestion.answerIndex]}. 💛`
    );
    setQuestionPhase("resolved");
    setAnsweredCount((previous) => previous + 1);
    scheduleContinue();
  };

  const handleBlankAnswerChange = (index: number, value: string) => {
    setBlankAnswers((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? value : entry))
    );
  };

  const handleBlankSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentQuestion || currentQuestion.kind !== "fill-in-the-blanks") return;
    if (
      questionPhase === "awaiting-hint" ||
      questionPhase === "replaying-hint" ||
      questionPhase === "resolved"
    ) {
      return;
    }

    const normalizedUserAnswers = blankAnswers.map(normalizeBlankAnswer);
    if (normalizedUserAnswers.some((answer) => !answer)) {
      setFeedback("Fill in every blank before submitting your answer.");
      return;
    }

    const normalizedCorrectAnswers = currentQuestion.blanks.map(normalizeBlankAnswer);
    const isCorrect = normalizedUserAnswers.every(
      (answer, index) => answer === normalizedCorrectAnswers[index]
    );
    const selectedAnswer = blankAnswers.join(", ");

    if (isCorrect) {
      reportQuestionResult(currentQuestion, true, selectedAnswer);
      setFeedback("Correct! You filled in every blank.");
      setQuestionPhase("resolved");
      setScore((previous) => previous + 1);
      setAnsweredCount((previous) => previous + 1);
      scheduleContinue();
      return;
    }

    if (!hintUsed) {
      setFeedback("Almost there. Use Hint to replay the sentence, then try the blanks one more time.");
      setQuestionPhase("awaiting-hint");
      return;
    }

    reportQuestionResult(currentQuestion, false, selectedAnswer);
    setFeedback(
      `Close one. The missing word${currentQuestion.blanks.length > 1 ? "s were" : " was"} ${currentQuestion.blanks.join(", ")}.`
    );
    setQuestionPhase("resolved");
    setAnsweredCount((previous) => previous + 1);
    scheduleContinue();
  };

  const handlePlantIconPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    draggingPlantIconRef.current = false;
    plantDragOffsetRef.current = {
      x: event.clientX - plantWidgetPosition.x,
      y: event.clientY - plantWidgetPosition.y,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      draggingPlantIconRef.current = true;
      setPlantWidgetPosition(
        clampPlantIconPosition(
          moveEvent.clientX - plantDragOffsetRef.current.x,
          moveEvent.clientY - plantDragOffsetRef.current.y
        )
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.setTimeout(() => {
        draggingPlantIconRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handlePlantWidgetPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }

    plantDragOffsetRef.current = {
      x: event.clientX - plantWidgetPosition.x,
      y: event.clientY - plantWidgetPosition.y,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setPlantWidgetPosition(
        clampPlantPanelPosition(
          moveEvent.clientX - plantDragOffsetRef.current.x,
          moveEvent.clientY - plantDragOffsetRef.current.y
        )
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const currentAccuracy = answeredCount
    ? Math.round((score / answeredCount) * 100)
    : 0;
  const plantGrowthStage = Math.min(10, Math.floor(currentAccuracy / 10));

  const handleHintClick = () => {
    const activeQuestion = currentQuestionRef.current;
    if (!activeQuestion || hintUsed) return;

    const currentTime =
      getCurrentPlaybackTime() ??
      questionPauseTimeRef.current ??
      activeQuestion.timestamp;
    const rewindTime = Math.max(0, currentTime - 5);
    const replayStopTime = questionPauseTimeRef.current ?? currentTime;
    const replayDurationMs = Math.max(
      250,
      Math.round((replayStopTime - rewindTime) * 1000)
    );

    setHintUsed(true);
    setQuestionPhase("replaying-hint");
    setFeedback("Replaying the last 5 seconds... 👀");
    hintReplayActiveRef.current = true;
    if (hintReplayTimeoutRef.current) {
      window.clearTimeout(hintReplayTimeoutRef.current);
    }
    seekActiveMedia(rewindTime);
    playActiveMedia();
    startPolling();
    hintReplayTimeoutRef.current = window.setTimeout(() => {
      hintReplayTimeoutRef.current = null;
      hintReplayActiveRef.current = false;
      pauseActiveMedia();
      setQuestionPhase("second-attempt");
      setFeedback("Replay complete. You've got this, choose your answer. ✨");
    }, replayDurationMs);
  };

  const continueVideo = () => {
    if (hintReplayTimeoutRef.current) {
      window.clearTimeout(hintReplayTimeoutRef.current);
      hintReplayTimeoutRef.current = null;
    }
    if (resolveTimeoutRef.current) {
      window.clearTimeout(resolveTimeoutRef.current);
      resolveTimeoutRef.current = null;
    }
    setCurrentQuestion(null);
    setBlankAnswers([]);
    setFeedback(null);
    setQuestionPhase("answering");
    setHintUsed(false);
    hintReplayActiveRef.current = false;
    questionPauseTimeRef.current = null;
    playActiveMedia();
    startPolling();
  };

  const scheduleContinue = () => {
    if (resolveTimeoutRef.current) {
      window.clearTimeout(resolveTimeoutRef.current);
    }

    resolveTimeoutRef.current = window.setTimeout(() => {
      resolveTimeoutRef.current = null;
      continueVideo();
    }, 1200);
  };

  const handleClearHistory = () => {
    clearStoredHistory()
      .then(() => setHistory([]))
      .catch(console.error);
  };

  const handleSignIn = async (email: string, password: string) => {
    const nextSession = await signInWithEmail(email, password);
    setSession(nextSession);
    setUsername(nextSession.user.username);
    await loadAccountData();
  };

  const handleSignUp = async (
    email: string,
    nextUsername: string,
    password: string
  ): Promise<SignUpResult> => {
    const result = await signUpWithEmail(email, password, nextUsername);

    if (!result.session) {
      return result;
    }

    setSession(result.session);
    setUsername(nextUsername);
    await saveProfileSafely({
      username: nextUsername,
      theme: "light",
      settings: defaultSettings,
    });
    await loadAccountData();
    return result;
  };

  if (!authReady) {
    return (
      <div className={`min-h-screen ${isDarkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"}`} />
    );
  }

  if (!session) {
    return (
      <div
        className={`min-h-screen font-sans ${
          isDarkMode
            ? "bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] text-slate-100"
            : "bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.22),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_42%,_#f8fafc_100%)] text-slate-900"
        }`}
      >
        {authView === "landing" ? (
          <LandingPage
            isDarkMode={isDarkMode}
            onSelectAuth={(nextView) => setAuthView(nextView)}
          />
        ) : (
          <AuthPanel
            isDarkMode={isDarkMode}
            onSignIn={handleSignIn}
            onSignUp={handleSignUp}
            initialMode={authView}
            onBack={() => setAuthView("landing")}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen font-sans transition-colors duration-300 ${
        isDarkMode
          ? "bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] text-slate-100"
          : "bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.22),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_42%,_#f8fafc_100%)] text-slate-800"
      }`}
    >
      <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
        {confettiPieces.map((piece) => (
          <span
            key={piece.id}
            className="absolute rounded-sm opacity-0 animate-[confetti-burst_var(--confetti-duration)_ease-out_forwards]"
            style={{
              left: piece.left,
              top: piece.top,
              width: piece.size,
              height: piece.size * 0.6,
              backgroundColor: piece.color,
              transform: "translate(-50%, -50%)",
              ["--confetti-x" as string]: `${piece.dx}px`,
              ["--confetti-y" as string]: `${piece.dy}px`,
              ["--confetti-rotate" as string]: `${piece.rotation}deg`,
              ["--confetti-duration" as string]: `${piece.duration}ms`,
              animationDelay: `${piece.delay}ms`,
            }}
          />
        ))}
      </div>

      {activePage === "dashboard" && (
        <>
          {!isPlantWidgetMinimized ? (
            <div
              ref={plantWidgetRef}
              className={`animate-popup-panel-in fixed z-[75] w-[calc(100vw-2rem)] max-w-[290px] overflow-hidden rounded-[24px] border shadow-[0_24px_60px_rgba(15,23,42,0.24)] sm:rounded-[28px] ${
                isDarkMode
                  ? "border-emerald-900/60 bg-slate-950/88 text-slate-100"
                  : "border-emerald-200 bg-white/92 text-slate-900"
              }`}
              style={{
                left: plantWidgetPosition.x,
                top: plantWidgetPosition.y,
              }}
            >
              <div
                onPointerDown={handlePlantWidgetPointerDown}
                className={`relative cursor-move overflow-hidden px-5 py-4 ${
                  isDarkMode
                    ? "bg-[linear-gradient(180deg,_rgba(8,47,73,0.85),_rgba(5,46,22,0.8))]"
                    : "bg-[linear-gradient(180deg,_rgba(219,234,254,0.95),_rgba(220,252,231,0.95))]"
                }`}
              >
                <div className="absolute inset-0 opacity-60 animate-[shimmer-slide_3.2s_linear_infinite] bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.18),transparent)]" />
                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                      Growth buddy
                    </p>
                    <h3 className="mt-2 text-lg font-bold">Echolearn Plant</h3>
                    <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                      It grows every time your accuracy crosses another 10%.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsPlantWidgetMinimized(true)}
                    className={`rounded-full border p-2 transition-all duration-300 hover:-translate-y-0.5 ${
                      isDarkMode
                        ? "border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
                        : "border-white/70 bg-white/80 text-slate-600 hover:bg-white"
                    }`}
                    aria-label="Minimize growth buddy"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.8}
                      stroke="currentColor"
                      className="h-4 w-4"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-2xl border px-4 py-3 ${isDarkMode ? "border-slate-800 bg-slate-900/80" : "border-slate-200 bg-slate-50/80"}`}>
                    <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                      Accuracy
                    </p>
                    <p className="mt-2 text-3xl font-bold text-emerald-500">
                      {currentAccuracy}%
                    </p>
                  </div>
                  <div className={`rounded-2xl border px-4 py-3 ${isDarkMode ? "border-slate-800 bg-slate-900/80" : "border-slate-200 bg-slate-50/80"}`}>
                    <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                      Stage
                    </p>
                    <p className="mt-2 text-3xl font-bold text-sky-500">
                      {plantGrowthStage}/10
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <PlantGrowthScene
                    stage={plantGrowthStage}
                    accuracy={currentAccuracy}
                    isDarkMode={isDarkMode}
                  />
                </div>
                <p className={`mt-3 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  {answeredCount === 0
                    ? "Answer a question to start growing your little dashboard plant."
                    : `${score} correct out of ${answeredCount} answered this session.`}
                </p>
              </div>
            </div>
          ) : (
            <button
              onPointerDown={handlePlantIconPointerDown}
              onClick={() => {
                if (!draggingPlantIconRef.current) {
                  setPlantWidgetPosition((current) =>
                    clampPlantPanelPosition(current.x, current.y)
                  );
                  setIsPlantWidgetMinimized(false);
                }
              }}
              className={`fixed z-[75] flex h-14 w-14 items-center justify-center rounded-full border shadow-[0_18px_34px_rgba(15,23,42,0.28)] transition-transform duration-300 hover:scale-105 ${
                isDarkMode
                  ? "border-emerald-900 bg-slate-900 text-emerald-300"
                  : "border-emerald-200 bg-white text-emerald-700"
              }`}
              style={{
                left: plantWidgetPosition.x,
                top: plantWidgetPosition.y,
              }}
              aria-label="Open growth buddy"
            >
              <span className="text-2xl">🪴</span>
            </button>
          )}
        </>
      )}

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

      <button
        onClick={() => setIsNavOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-900/30 transition-all duration-300 ${
          isNavOpen
            ? "pointer-events-auto opacity-100 backdrop-blur-[2px]"
            : "pointer-events-none opacity-0 backdrop-blur-0"
        }`}
        aria-label="Close navigation menu"
      />

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col px-5 py-6 text-white shadow-2xl transition-all duration-300 ease-out ${
          isDarkMode
            ? "border-r border-slate-700 bg-[#020817]"
            : "border-r border-slate-200 bg-[#081120]"
        } ${
          isNavOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-70"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              Echolearn
            </p>
            <h2 className="mt-2 text-2xl font-bold">Daily Learning Companion</h2>
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
            label="Echolearn Home"
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
          <NavButton
            label="Past Attempts"
            active={activePage === "past-attempts"}
            onClick={() => {
              setActivePage("past-attempts");
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
        isDarkMode={isDarkMode}
        onSave={(newSettings) => {
          setSettings(newSettings);
        }}
      />

      <header
        className={`animate-fade-up flex flex-wrap items-start justify-between gap-4 border-b px-16 py-4 sm:items-center sm:px-20 ${
          isDarkMode ? "border-slate-800/80" : "border-slate-200/80"
        }`}
      >
        <div>
          <p
            className={`text-sm font-semibold uppercase tracking-[0.24em] ${
              isDarkMode ? "text-sky-300" : "text-sky-700"
            }`}
          >
            {activePage === "dashboard"
              ? "Dashboard"
              : activePage === "statistics"
              ? "Statistics"
              : "Past Attempts"}
          </p>
          <h1 className={`mt-1 text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
            {activePage === "dashboard"
              ? `Good ${timeOfDayGreeting}, ${username}`
              : activePage === "statistics"
              ? "Echolearn Progress"
              : "Echolearn History"}
          </h1>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
          <button
            onClick={() => {
              signOut();
              setSession(null);
              setHistory([]);
              setCurrentQuestion(null);
              setVideoId("");
              setPendingVideoId("");
              resetUploadedMedia();
            }}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${
              isDarkMode
                ? "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                : "border-slate-200 bg-white/80 text-slate-700 hover:bg-white"
            }`}
          >
            Sign out
          </button>
          <button
            onClick={() => setIsDarkMode((previous) => !previous)}
            className={`animate-soft-float inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${
              isDarkMode
                ? "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                : "border-slate-200 bg-white/80 text-slate-700 hover:bg-white"
            }`}
          >
            <span>{isDarkMode ? "Dark" : "Light"}</span>
            <span aria-hidden="true">{isDarkMode ? "🌙" : "☀️"}</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`rounded-md border p-2 transition-all duration-300 hover:-translate-y-0.5 hover:rotate-6 ${
              isDarkMode
                ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
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
        </div>
      </header>

      {activePage === "dashboard" ? (
        <>
          <div
            className={`animate-fade-up border-b px-6 py-4 backdrop-blur ${
              isDarkMode
                ? "border-slate-800/80 bg-slate-950/30"
                : "border-slate-200/80 bg-white/40"
            }`}
          >
            <form
              onSubmit={handleLoadVideo}
              className="mx-auto grid max-w-[1600px] gap-3 sm:gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto] lg:items-center"
            >
              <button
                type="submit"
                disabled={loading}
                className="animate-pulse-glow rounded-2xl bg-[#0b0f19] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 justify-self-start"
              >
                {loading ? "Generating..." : "Load Video"}
              </button>
              <div className="flex w-full lg:min-w-0">
                <input
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className={`w-full rounded-2xl border px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-slate-800 ${
                    isDarkMode
                      ? "border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-400 focus:bg-slate-900"
                      : "border-slate-200 bg-white/90 text-slate-800 focus:bg-white"
                  }`}
                />
              </div>
              <label className={`flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-semibold shadow-sm transition ${isDarkMode ? "border-sky-700 bg-slate-900/80 text-slate-100 hover:border-sky-500 hover:bg-slate-900" : "border-sky-400 bg-white/95 text-slate-800 hover:border-sky-600 hover:bg-white"}`}>
                <input
                  type="file"
                  accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.m4v,.webm,.mpeg,.mpg"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setSelectedFile(nextFile);
                    if (nextFile) {
                      setUrlInput("");
                    }
                  }}
                  className="hidden"
                />
                {selectedFile ? `Selected: ${selectedFile.name}` : "Upload audio or video"}
              </label>
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    resetUploadedMedia();
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${isDarkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  Clear File
                </button>
              )}
              {loadError && (
                <p className="text-sm font-medium text-rose-600">{loadError}</p>
              )}
            </form>
          </div>

          <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8 lg:grid-cols-12 lg:items-start">
            <div className="flex flex-col lg:col-span-8">
              <div
                className={`animate-fade-up rounded-[28px] border p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur ${
                  isDarkMode
                    ? "border-slate-800 bg-slate-900/70"
                    : "border-slate-200 bg-white/80"
                }`}
              >
                {loading ? (
                  <GenerationPanel
                    progress={generationProgress}
                    stage={generationStage}
                  />
                ) : videoId ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className={`text-sm font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-sky-300" : "text-sky-700"}`}>
                          Active video
                        </p>
                        <h2 className={`mt-1 text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                          {videoTitle || "Loading video details..."}
                        </h2>
                      </div>
                      <div className={`animate-soft-float rounded-full px-4 py-2 text-sm font-semibold ${isDarkMode ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
                        Score: {score} / {questionsRef.current.length || "-"}
                      </div>
                    </div>

                    <div className="relative aspect-video overflow-hidden rounded-[24px] border border-slate-200 bg-black">
                      {mediaKind === "youtube" ? (
                        <div id="yt-player" className="absolute inset-0" />
                      ) : mediaKind === "video-upload" && uploadedMedia ? (
                        <video
                          key={uploadedMedia.id}
                          ref={mediaElementRef as React.RefObject<HTMLVideoElement>}
                          className="absolute inset-0 h-full w-full object-contain"
                          src={uploadedMedia.objectUrl}
                          controls
                          playsInline
                        />
                      ) : uploadedMedia ? (
                        <div className={`absolute inset-0 flex flex-col justify-center overflow-hidden p-6 ${isDarkMode ? "bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#0f172a_55%,_#111827_100%)]" : "bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.24),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#e0f2fe_48%,_#eff6ff_100%)]"}`}>
                          <div className="mb-6 flex items-end gap-2">
                            {Array.from({ length: 20 }, (_, index) => (
                              <span
                                key={index}
                                className={`w-2 rounded-full ${isDarkMode ? "bg-cyan-300/80" : "bg-sky-500/70"}`}
                                style={{ height: `${20 + ((index * 17) % 64)}px` }}
                              />
                            ))}
                          </div>
                          <div className="mb-4">
                            <p className={`text-xs font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
                              Uploaded audio
                            </p>
                            <h3 className={`mt-2 text-xl font-bold ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                              {uploadedMedia.title}
                            </h3>
                          </div>
                          <audio
                            key={uploadedMedia.id}
                            ref={mediaElementRef as React.RefObject<HTMLAudioElement>}
                            className="w-full"
                            src={uploadedMedia.objectUrl}
                            controls
                          />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className={`flex aspect-video items-center justify-center rounded-[24px] border-2 border-dashed ${isDarkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"}`}>
                    {selectedFile ? (
                      <div className="flex w-full max-w-2xl flex-col items-center px-6 text-center">
                        <div className="mb-6 flex w-full items-end justify-center gap-2">
                          {Array.from({ length: 24 }, (_, index) => (
                            <span
                              key={index}
                              className={`w-2 rounded-full ${isDarkMode ? "bg-cyan-300/80" : "bg-sky-500/70"}`}
                              style={{ height: `${18 + ((index * 13) % 56)}px` }}
                            />
                          ))}
                        </div>
                        <p className={`text-xs font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
                          File selected
                        </p>
                        <h3 className={`mt-2 text-xl font-bold ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                          {selectedFile.name}
                        </h3>
                        <p className={`mt-4 max-w-xl text-sm leading-7 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                          Press the <span className="font-semibold">Load Video</span> button to start processing and open the media player.
                        </p>
                      </div>
                    ) : (
                      <p className="font-medium text-slate-400">
                        {pendingVideoId
                          ? "Generation finished. Preparing media..."
                          : "Load a YouTube link or upload media to get started with Echolearn"}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {!loading && videoId && (
                <p className={`mt-4 text-sm font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Pause the video to reveal quiz questions. Finishing the video
                  saves this score to your local results database.
                </p>
              )}
            </div>

            <div className="flex w-full flex-col lg:col-span-4">
              <div className="mb-4">
                <h2 className={`text-[1.15rem] font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
                  Quiz panel
                </h2>
                <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Answer in-video questions and keep your streak moving. 🌟
                </p>
              </div>

              <div className={`animate-fade-up flex min-h-[220px] flex-col rounded-[28px] border p-5 shadow-sm sm:p-8 ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
                {currentQuestion ? (
                  <div className="flex flex-col gap-4">
                    <h3 className={`mb-5 text-center text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
                      {currentQuestion.kind === "fill-in-the-blanks"
                        ? "Fill in what the speaker just said"
                        : currentQuestion.question}
                    </h3>

                    {questionPhase === "resolved" ? (
                      <div className="flex flex-col items-center gap-3">
                        <p
                          className={`text-base font-bold ${
                            feedback?.startsWith("Correct!")
                              ? "text-emerald-600"
                              : "text-rose-600"
                          }`}
                        >
                          {feedback?.startsWith("Correct!") ? "🎉 " : "💛 "}
                          {feedback}
                        </p>
                        <p className={`text-sm font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                          Moving to the next question...
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {feedback && (
                          <p
                            className={`text-center text-sm font-semibold ${
                              questionPhase === "awaiting-hint"
                                ? "text-amber-600"
                                : isDarkMode
                                ? "text-slate-400"
                                : "text-slate-500"
                            }`}
                          >
                            {feedback}
                          </p>
                        )}
                        {currentQuestion.kind === "multiple-choice" ? (
                          currentQuestion.choices.map((choice, index) => (
                            <button
                              key={index}
                              onClick={(event) => handleAnswerClick(index, event)}
                              disabled={
                                questionPhase === "awaiting-hint" ||
                                questionPhase === "replaying-hint"
                              }
                              className={`w-full rounded-2xl border px-4 py-3 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-80 ${
                                isDarkMode
                                  ? "border-slate-700 bg-slate-800 text-slate-100 hover:border-slate-500 hover:bg-slate-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-800 hover:bg-slate-50"
                              }`}
                            >
                              {choice}
                            </button>
                          ))
                        ) : (
                          <form onSubmit={handleBlankSubmit} className="flex flex-col gap-4">
                            <div className={`rounded-[24px] border px-4 py-5 sm:px-5 ${isDarkMode ? "border-slate-700 bg-slate-950/70" : "border-slate-200 bg-slate-50/80"}`}>
                              <p className={`mb-3 text-xs font-semibold uppercase tracking-[0.22em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
                                Live transcript prompt
                              </p>
                              <div className="rounded-[22px] bg-gradient-to-br from-sky-500/15 via-transparent to-emerald-400/10 p-4">
                                <FillInTheBlanksSentence
                                  question={currentQuestion}
                                  answers={blankAnswers}
                                  disabled={
                                    questionPhase === "awaiting-hint" ||
                                    questionPhase === "replaying-hint"
                                  }
                                  isDarkMode={isDarkMode}
                                  onChange={handleBlankAnswerChange}
                                />
                              </div>
                            </div>
                            <button
                              type="submit"
                              disabled={
                                questionPhase === "awaiting-hint" ||
                                questionPhase === "replaying-hint"
                              }
                              className="rounded-2xl bg-[#0b0f19] px-4 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              Check blanks
                            </button>
                          </form>
                        )}
                        <div className={`animate-fade-up mt-2 rounded-2xl border px-4 py-3 ${isDarkMode ? "border-sky-900/60 bg-sky-950/40" : "border-sky-200 bg-sky-50"}`}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className={`text-sm font-semibold ${isDarkMode ? "text-sky-200" : "text-sky-900"}`}>
                                Need a hint? 
                              </p>
                              <p className={`text-xs ${isDarkMode ? "text-sky-300" : "text-sky-700"}`}>
                                Rewinds 5 seconds and replays once for this question.
                              </p>
                            </div>
                            <button
                              onClick={handleHintClick}
                              disabled={hintUsed || questionPhase === "replaying-hint"}
                              className={`w-full rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed sm:w-auto ${
                                isDarkMode
                                  ? "border-sky-800 bg-slate-900 text-sky-200 hover:bg-slate-800 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
                                  : "border-sky-300 bg-white text-sky-700 hover:bg-sky-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                              }`}
                            >
                              {questionPhase === "replaying-hint"
                                ? "Replaying..."
                                : hintUsed
                                ? "Hint Used"
                                : "Hint"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className={`my-auto text-center text-sm font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500/80"}`}>
                    {loading
                      ? `${generationStage} (${generationProgress}%)`
                      : videoId
                      ? "Pause the video to start answering questions"
                      : "Questions will appear after generation completes"}
                  </p>
                )}
              </div>

              <div className={`animate-fade-up mt-6 rounded-[28px] border p-6 shadow-sm ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/85"}`}>
                <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Progress snapshot
                </p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <SnapshotCard label="Current score" value={`${score}`} isDarkMode={isDarkMode} />
                  <SnapshotCard label="Saved sessions" value={`${history.length}`} isDarkMode={isDarkMode} />
                </div>
              </div>
            </div>
          </main>
        </>
      ) : activePage === "statistics" ? (
        <main className="mx-auto max-w-[1600px] px-6 py-8">
          <StatisticsPage
            history={history}
            onClearHistory={handleClearHistory}
            isDarkMode={isDarkMode}
          />
        </main>
      ) : (
        <main className="mx-auto max-w-[1600px] px-6 py-8">
          <PastAttemptsPage history={history} isDarkMode={isDarkMode} />
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

function FillInTheBlanksSentence({
  question,
  answers,
  disabled,
  isDarkMode,
  onChange,
}: {
  question: Extract<Question, { kind: "fill-in-the-blanks" }>;
  answers: string[];
  disabled: boolean;
  isDarkMode: boolean;
  onChange: (index: number, value: string) => void;
}) {
  const parts = question.sentenceWithBlanks.split(/(\[BLANK_\d+\])/g);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3 text-lg leading-8">
      {parts.map((part, index) => {
        const blankMatch = part.match(/\[BLANK_(\d+)\]/);
        if (!blankMatch) {
          return (
            <span
              key={`${part}-${index}`}
              className={isDarkMode ? "text-slate-100" : "text-slate-800"}
            >
              {part}
            </span>
          );
        }

        const blankIndex = Number(blankMatch[1]) - 1;
        return (
          <input
            key={`${part}-${index}`}
            type="text"
            value={answers[blankIndex] ?? ""}
            onChange={(event) => onChange(blankIndex, event.target.value)}
            disabled={disabled}
            placeholder={`Blank ${blankIndex + 1}`}
            className={`min-w-[110px] flex-1 rounded-xl border px-3 py-2 text-base font-semibold outline-none transition ${isDarkMode ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400" : "border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:border-sky-500"}`}
          />
        );
      })}
    </div>
  );
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
  isDarkMode,
}: {
  label: string;
  value: string;
  isDarkMode: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${isDarkMode ? "border-slate-700 bg-slate-800/80" : "border-slate-200 bg-slate-50/80"}`}>
      <p className={`text-sm font-semibold ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-2 text-2xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function LegacyLandingPage({
  isDarkMode,
  onSelectAuth,
}: {
  isDarkMode: boolean;
  onSelectAuth: (mode: "signin" | "signup") => void;
}) {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className={`absolute -left-20 top-16 h-72 w-72 rounded-full blur-3xl ${isDarkMode ? "bg-cyan-500/20" : "bg-sky-300/35"}`} />
        <div className={`absolute right-[-6rem] top-40 h-96 w-96 rounded-full blur-3xl ${isDarkMode ? "bg-emerald-500/12" : "bg-emerald-200/60"}`} />
        <div className={`absolute bottom-10 left-1/3 h-80 w-80 rounded-full blur-3xl ${isDarkMode ? "bg-orange-500/10" : "bg-amber-200/45"}`} />
      </div>

      <div className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.34em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
              Echolearn
            </p>
            <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
              Interactive listening practice for real-world media
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => onSelectAuth("signin")}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 ${
                isDarkMode
                  ? "border-slate-700 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
                  : "border-slate-200 bg-white/85 text-slate-700 hover:bg-white"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => onSelectAuth("signup")}
              className="rounded-full bg-[#0b0f19] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(11,15,25,0.28)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Create account
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <div className="animate-fade-up">
            <p className={`text-sm font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
              Listening training reimagined
            </p>
            <h1 className={`mt-4 max-w-4xl text-4xl font-bold leading-[1.02] sm:text-5xl lg:text-7xl ${isDarkMode ? "text-white" : "text-slate-950"}`}>
              Turn any YouTube lesson into adaptive cochlear training and comprehension practice.
            </h1>
            <p className={`mt-6 max-w-2xl text-base leading-8 sm:text-lg ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
              Echolearn helps learners and hearing rehabilitation users stay engaged with authentic media.
              We generate timed checkpoints, replay-aware hints, progress tracking, and personalized listening challenges
              so practice feels alive instead of repetitive.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {[
                "Cochlear-first listening exercises",
                "Adaptive question density",
                "Progress history and accuracy tracking",
              ].map((pill) => (
                <span
                  key={pill}
                  className={`rounded-full border px-4 py-2 text-sm font-medium ${
                    isDarkMode
                      ? "border-slate-800 bg-slate-900/70 text-slate-200"
                      : "border-slate-200 bg-white/85 text-slate-700"
                  }`}
                >
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <div className="animate-fade-up" style={{ animationDelay: "120ms" }}>
            <div
              className={`relative overflow-hidden rounded-[32px] border p-4 shadow-[0_28px_80px_rgba(15,23,42,0.2)] ${
                isDarkMode
                  ? "border-slate-800 bg-slate-950/75"
                  : "border-slate-200 bg-white/85"
              }`}
            >
              <div className="absolute inset-0 bg-[linear-gradient(130deg,transparent,rgba(255,255,255,0.08),transparent)] animate-[shimmer-slide_3.8s_linear_infinite]" />
              <div className="relative overflow-hidden rounded-[24px]">
                <img
                  src={heroImage}
                  alt="Echolearn product preview"
                  className="h-[250px] w-full object-cover sm:h-[340px] lg:h-[420px]"
                />
              </div>
              <div className="relative mt-4 grid gap-3 sm:grid-cols-3">
                <ProductStat
                  isDarkMode={isDarkMode}
                  label="Focus"
                  value="Cochlear"
                  detail="Built to foreground listening rehabilitation, not hide it."
                />
                <ProductStat
                  isDarkMode={isDarkMode}
                  label="Flow"
                  value="In-video"
                  detail="Questions appear at the moment the media becomes meaningful."
                />
                <ProductStat
                  isDarkMode={isDarkMode}
                  label="Memory"
                  value="Tracked"
                  detail="Progress, settings, and history stay tied to the user account."
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <StoryCard
            isDarkMode={isDarkMode}
            eyebrow="The problem"
            title="Most listening tools feel detached from real media."
            body="Traditional drills are static, decontextualized, and hard to stick with. Learners either get generic comprehension quizzes or isolated hearing exercises that don’t resemble the content they actually want to engage with."
          />
          <StoryCard
            isDarkMode={isDarkMode}
            eyebrow="Our approach"
            title="We fuse authentic videos with guided listening checkpoints."
            body="Echolearn watches the same timeline the learner does. It pauses at meaningful moments, asks targeted questions, offers replay-based hints, and keeps the interaction grounded in the exact content being heard."
          />
          <StoryCard
            isDarkMode={isDarkMode}
            eyebrow="Why it matters"
            title="Progress becomes visible, personal, and motivating."
            body="By combining saved settings, adaptive cochlear-focused prompts, history, and performance summaries, the experience starts to feel like a living learning companion rather than a one-off quiz."
          />
        </section>

        <section
          className={`grid gap-6 overflow-hidden rounded-[36px] border p-6 sm:p-8 lg:grid-cols-[0.95fr_1.05fr] ${
            isDarkMode
              ? "border-slate-800 bg-[linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.92),rgba(8,47,73,0.78))]"
              : "border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(239,246,255,0.94),rgba(236,253,245,0.9))]"
          }`}
        >
          <div>
            <p className={`text-sm font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
              What users experience
            </p>
            <h2 className={`mt-3 text-3xl font-bold sm:text-4xl ${isDarkMode ? "text-white" : "text-slate-950"}`}>
              A guided journey from video intake to measurable listening growth.
            </h2>
            <p className={`mt-4 text-base leading-8 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
              Users choose cochlear or lecture mode, set the density of their checkpoints, load a YouTube link,
              and move through timed questions that test either phonetic discrimination or understanding. Each session
              feeds the profile, statistics, and saved attempt history so the platform gets more personally useful over time.
            </p>
          </div>
          <div className="grid gap-4">
            <StepCard
              isDarkMode={isDarkMode}
              number="01"
              title="Bring in real-world media"
              body="Paste any supported YouTube link and let Echolearn turn it into an interactive listening session."
            />
            <StepCard
              isDarkMode={isDarkMode}
              number="02"
              title="Practice with intentional pauses"
              body="Timed questions appear after meaningful moments, with hints that replay the last five seconds when needed."
            />
            <StepCard
              isDarkMode={isDarkMode}
              number="03"
              title="Review growth over time"
              body="Saved history, dashboard progress, and statistics give users a concrete picture of how their listening is evolving."
            />
          </div>
        </section>
      </main>
    </div>
  );
}

void LegacyLandingPage;

function ScrollReveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -10% 0px",
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      data-visible={isVisible ? "true" : "false"}
      className={`scroll-reveal ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function LandingPage({
  isDarkMode,
  onSelectAuth,
}: {
  isDarkMode: boolean;
  onSelectAuth: (mode: "signin" | "signup") => void;
}) {
  const heroPills = ["Real video", "Live checkpoints", "Adaptive focus"];
  const featureCards = [
    {
      eyebrow: "Less friction",
      title: "Load. Listen. Respond.",
      body: "No dead drills. No detached quiz sheet.",
    },
    {
      eyebrow: "More signal",
      title: "Questions hit on cue.",
      body: "The pause lands when the moment matters.",
    },
    {
      eyebrow: "Real adaptation",
      title: "Weak spots stay in focus.",
      body: "Mastered patterns fade into the background.",
    },
  ];

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className={`absolute -left-20 top-16 h-72 w-72 rounded-full blur-3xl ${isDarkMode ? "bg-cyan-500/20" : "bg-sky-300/35"}`} />
        <div className={`absolute right-[-6rem] top-40 h-96 w-96 rounded-full blur-3xl ${isDarkMode ? "bg-emerald-500/12" : "bg-emerald-200/60"}`} />
        <div className={`absolute bottom-10 left-1/3 h-80 w-80 rounded-full blur-3xl ${isDarkMode ? "bg-orange-500/10" : "bg-amber-200/45"}`} />
        <div className={`absolute inset-x-0 top-[32rem] h-px ${isDarkMode ? "bg-white/8" : "bg-slate-200/70"}`} />
      </div>

      <div className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.34em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
              Echolearn
            </p>
            <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
              Interactive listening practice for real-world media
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => onSelectAuth("signin")}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 ${
                isDarkMode
                  ? "border-slate-700 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
                  : "border-slate-200 bg-white/85 text-slate-700 hover:bg-white"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => onSelectAuth("signup")}
              className="rounded-full bg-[#0b0f19] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(11,15,25,0.28)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Create account
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <ScrollReveal className="lg:pr-4">
            <p className={`text-sm font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
              Listening, redesigned
            </p>
            <h1 className={`mt-4 max-w-4xl text-4xl font-bold leading-[1.02] sm:text-5xl lg:text-7xl ${isDarkMode ? "text-white" : "text-slate-950"}`}>
              Real video.
              <br />
              Sharper listening.
              <br />
              Smarter practice.
            </h1>
            <p className={`mt-6 max-w-xl text-base leading-7 sm:text-lg ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
              Turn everyday lessons into guided listening sessions.
              Short pauses. Sharp questions. Personal feedback.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {heroPills.map((pill, index) => (
                <span
                  key={pill}
                  className={`scroll-float rounded-full border px-4 py-2 text-sm font-medium ${
                    isDarkMode
                      ? "border-slate-800 bg-slate-900/70 text-slate-200"
                      : "border-slate-200 bg-white/85 text-slate-700"
                  }`}
                  style={{ animationDelay: `${index * 220}ms` }}
                >
                  {pill}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => onSelectAuth("signup")}
                className="rounded-full bg-[#0b0f19] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(11,15,25,0.28)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Start free
              </button>
              <button
                onClick={() => onSelectAuth("signin")}
                className={`rounded-full border px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 ${
                  isDarkMode
                    ? "border-slate-700 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
                    : "border-slate-200 bg-white/85 text-slate-700 hover:bg-white"
                }`}
              >
                See your progress
              </button>
            </div>
            <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
              <div className={`rounded-[24px] border px-4 py-4 ${isDarkMode ? "border-slate-800 bg-slate-900/65" : "border-slate-200 bg-white/80"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Modes</p>
                <p className={`mt-2 text-2xl font-bold ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>2</p>
                <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>Lecture and cochlear.</p>
              </div>
              <div className={`rounded-[24px] border px-4 py-4 ${isDarkMode ? "border-slate-800 bg-slate-900/65" : "border-slate-200 bg-white/80"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Hints</p>
                <p className={`mt-2 text-2xl font-bold ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>5s</p>
                <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>Replay the exact moment.</p>
              </div>
              <div className={`rounded-[24px] border px-4 py-4 ${isDarkMode ? "border-slate-800 bg-slate-900/65" : "border-slate-200 bg-white/80"}`}>
                <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Memory</p>
                <p className={`mt-2 text-2xl font-bold ${isDarkMode ? "text-amber-300" : "text-amber-700"}`}>Live</p>
                <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>Future questions adapt.</p>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal className="lg:pl-2" delay={120}>
            <div
              className={`scroll-depth-card relative overflow-hidden rounded-[36px] border p-4 shadow-[0_28px_80px_rgba(15,23,42,0.2)] ${
                isDarkMode
                  ? "border-slate-800 bg-slate-950/75"
                  : "border-slate-200 bg-white/85"
              }`}
            >
              <div className="absolute inset-0 bg-[linear-gradient(130deg,transparent,rgba(255,255,255,0.08),transparent)] animate-[shimmer-slide_3.8s_linear_infinite]" />
              <div className={`absolute left-4 top-4 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] backdrop-blur ${
                isDarkMode
                  ? "border-cyan-500/20 bg-slate-900/70 text-cyan-300"
                  : "border-sky-200 bg-white/80 text-sky-700"
              }`}>
                Scroll. Pause. Improve.
              </div>
              <div className="relative overflow-hidden rounded-[24px]">
                <img
                  src={heroImage}
                  alt="Echolearn product preview"
                  className="h-[250px] w-full object-cover sm:h-[340px] lg:h-[420px]"
                />
              </div>
              <div className="pointer-events-none absolute inset-x-6 top-[5.25rem] hidden justify-between sm:flex">
                <div className={`scroll-float rounded-[20px] border px-4 py-3 shadow-xl backdrop-blur ${
                  isDarkMode
                    ? "border-white/10 bg-slate-900/75 text-slate-100"
                    : "border-white/80 bg-white/80 text-slate-900"
                }`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-500">Checkpoint</p>
                  <p className="mt-2 text-sm font-semibold">Catch the phrase.</p>
                </div>
                <div className={`scroll-float rounded-[20px] border px-4 py-3 shadow-xl backdrop-blur ${
                  isDarkMode
                    ? "border-white/10 bg-slate-900/75 text-slate-100"
                    : "border-white/80 bg-white/80 text-slate-900"
                }`} style={{ animationDelay: "520ms" }}>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-500">Adaptive</p>
                  <p className="mt-2 text-sm font-semibold">Weak spots stay hot.</p>
                </div>
              </div>
              <div className="relative mt-4 grid gap-3 sm:grid-cols-3">
                <ProductStat
                  isDarkMode={isDarkMode}
                  label="Focus"
                  value="Precise"
                  detail="Train what matters."
                />
                <ProductStat
                  isDarkMode={isDarkMode}
                  label="Flow"
                  value="On cue"
                  detail="Pause at the right time."
                />
                <ProductStat
                  isDarkMode={isDarkMode}
                  label="Memory"
                  value="Adaptive"
                  detail="The system learns your patterns."
                />
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {featureCards.map((card, index) => (
            <ScrollReveal key={card.title} delay={index * 120}>
              <StoryCard
                isDarkMode={isDarkMode}
                eyebrow={card.eyebrow}
                title={card.title}
                body={card.body}
              />
            </ScrollReveal>
          ))}
        </section>

        <ScrollReveal>
          <section
            className={`grid gap-6 overflow-hidden rounded-[40px] border p-6 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] ${
              isDarkMode
                ? "border-slate-800 bg-[linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.92),rgba(8,47,73,0.78))]"
                : "border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(239,246,255,0.94),rgba(236,253,245,0.9))]"
            }`}
          >
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className={`text-sm font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>
                What it feels like
              </p>
              <h2 className={`mt-3 text-3xl font-bold sm:text-4xl ${isDarkMode ? "text-white" : "text-slate-950"}`}>
                Fast.
                <br />
                Focused.
                <br />
                Addictive.
              </h2>
              <p className={`mt-4 max-w-md text-base leading-7 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                You stay inside the video.
                The system handles the coaching.
              </p>
            </div>
            <div className="grid gap-4">
              <ScrollReveal delay={40}>
                <StepCard
                  isDarkMode={isDarkMode}
                  number="01"
                  title="Bring any lesson in"
                  body="Paste a link. Or drop a file."
                />
              </ScrollReveal>
              <ScrollReveal delay={120}>
                <StepCard
                  isDarkMode={isDarkMode}
                  number="02"
                  title="Catch the exact moment"
                  body="The player pauses when the idea lands."
                />
              </ScrollReveal>
              <ScrollReveal delay={200}>
                <StepCard
                  isDarkMode={isDarkMode}
                  number="03"
                  title="Train the pattern"
                  body="Hard words repeat more. Mastered ones step back."
                />
              </ScrollReveal>
            </div>
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section
            className={`relative overflow-hidden rounded-[40px] border p-6 sm:p-8 ${
              isDarkMode
                ? "border-slate-800 bg-slate-950/75"
                : "border-slate-200 bg-white/88"
            }`}
          >
            <div className={`absolute inset-0 opacity-70 ${isDarkMode ? "bg-[radial-gradient(circle_at_top_right,_rgba(45,212,191,0.16),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(56,189,248,0.18),_transparent_40%)]" : "bg-[radial-gradient(circle_at_top_right,_rgba(52,211,153,0.18),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(125,211,252,0.24),_transparent_40%)]"}`} />
            <div className="relative grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <div>
                <p className={`text-sm font-semibold uppercase tracking-[0.28em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                  Why it sticks
                </p>
                <h2 className={`mt-3 text-3xl font-bold sm:text-4xl ${isDarkMode ? "text-white" : "text-slate-950"}`}>
                  Less reading.
                  <br />
                  More listening.
                </h2>
              </div>
              <p className={`max-w-xl text-base leading-7 lg:justify-self-end ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                Every session leaves a trace.
                The next one gets better.
              </p>
            </div>
          </section>
        </ScrollReveal>
      </main>
    </div>
  );
}

function StoryCard({
  isDarkMode,
  eyebrow,
  title,
  body,
}: {
  isDarkMode: boolean;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <article
      className={`group rounded-[30px] border p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)] transition duration-500 hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(15,23,42,0.14)] ${
        isDarkMode
          ? "border-slate-800 bg-slate-900/75 text-slate-100"
          : "border-slate-200 bg-white/85 text-slate-900"
      }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-sky-300" : "text-sky-700"}`}>
        {eyebrow}
      </p>
      <h3 className="mt-4 text-2xl font-bold leading-tight">{title}</h3>
      <p className={`mt-4 text-sm leading-7 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
        {body}
      </p>
    </article>
  );
}

function StepCard({
  isDarkMode,
  number,
  title,
  body,
}: {
  isDarkMode: boolean;
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div
      className={`rounded-[24px] border p-5 transition duration-500 hover:-translate-y-1 ${
        isDarkMode
          ? "border-white/10 bg-white/5 text-slate-100"
          : "border-white/60 bg-white/65 text-slate-900"
      }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
        {number}
      </p>
      <h3 className="mt-3 text-xl font-bold">{title}</h3>
      <p className={`mt-2 text-sm leading-7 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
        {body}
      </p>
    </div>
  );
}

function ProductStat({
  isDarkMode,
  label,
  value,
  detail,
}: {
  isDarkMode: boolean;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      className={`rounded-[22px] border p-4 transition duration-500 hover:-translate-y-1 ${
        isDarkMode
          ? "border-slate-800 bg-slate-900/80 text-slate-100"
          : "border-slate-200 bg-white/85 text-slate-900"
      }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${isDarkMode ? "text-cyan-300" : "text-sky-700"}`}>{value}</p>
      <p className={`mt-2 text-sm leading-6 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
        {detail}
      </p>
    </div>
  );
}

function PlantGrowthScene({
  stage,
  accuracy,
  isDarkMode,
}: {
  stage: number;
  accuracy: number;
  isDarkMode: boolean;
}) {
  const leaves = Array.from({ length: Math.min(stage, 6) }, (_, index) => ({
    id: index,
    side: index % 2 === 0 ? "left" : "right",
    bottom: 38 + index * 16,
    size: 18 + Math.min(index, 3) * 4,
    delay: `${index * 0.18}s`,
  }));
  const flowers = Array.from({ length: Math.max(stage - 6, 0) }, (_, index) => ({
    id: index,
    left: 30 + index * 18,
    delay: `${index * 0.2}s`,
  }));

  return (
    <div
      className={`relative h-56 overflow-hidden rounded-[26px] border ${
        isDarkMode
          ? "border-emerald-950/60 bg-[linear-gradient(180deg,_#082f49_0%,_#052e16_58%,_#14532d_100%)]"
          : "border-emerald-100 bg-[linear-gradient(180deg,_#dbeafe_0%,_#ecfccb_55%,_#86efac_100%)]"
      }`}
    >
      <div className={`absolute inset-x-0 bottom-0 h-20 ${isDarkMode ? "bg-[linear-gradient(180deg,_#166534_0%,_#14532d_100%)]" : "bg-[linear-gradient(180deg,_#4ade80_0%,_#22c55e_100%)]"}`} />
      <div className={`absolute right-5 top-4 h-12 w-12 rounded-full ${isDarkMode ? "bg-sky-200/70 shadow-[0_0_26px_rgba(125,211,252,0.35)]" : "bg-yellow-200/90 shadow-[0_0_28px_rgba(253,224,71,0.55)]"}`} />
      <div className="absolute left-6 top-7 h-7 w-16 rounded-full bg-white/50 blur-sm" />

      <div className="absolute bottom-5 left-1/2 h-16 w-24 -translate-x-1/2 rounded-[22px_22px_30px_30px] border border-amber-900/10 bg-[linear-gradient(180deg,_#c08457_0%,_#9a5b35_100%)] shadow-[0_14px_26px_rgba(120,53,15,0.26)]" />
      <div className="absolute bottom-[78px] left-1/2 h-2.5 w-28 -translate-x-1/2 rounded-full bg-black/10 blur-sm" />

      {stage > 0 && (
        <div
          className="absolute bottom-[84px] left-1/2 w-2 -translate-x-1/2 rounded-full bg-emerald-700 transition-all duration-500"
          style={{ height: `${36 + stage * 11}px` }}
        />
      )}

      {leaves.map((leaf) => (
        <div
          key={leaf.id}
          className={`absolute animate-soft-float rounded-[100%_0_100%_0] bg-emerald-500 shadow-[0_8px_18px_rgba(34,197,94,0.28)] ${
            leaf.side === "left" ? "-rotate-[26deg]" : "rotate-[206deg]"
          }`}
          style={{
            bottom: leaf.bottom,
            width: leaf.size,
            height: leaf.size * 0.7,
            left: leaf.side === "left" ? "calc(50% - 30px)" : "calc(50% + 10px)",
            animationDelay: leaf.delay,
          }}
        />
      ))}

      {flowers.map((flower) => (
        <div
          key={flower.id}
          className="absolute animate-soft-float"
          style={{
            bottom: `${156 + flower.id * 4}px`,
            left: `calc(50% - ${flower.left}px)`,
            animationDelay: flower.delay,
          }}
        >
          <div className="relative h-5 w-5">
            <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-pink-300" />
            <span className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-rose-300" />
            <span className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-fuchsia-300" />
            <span className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-orange-300" />
            <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-200" />
          </div>
        </div>
      ))}

      <div className={`absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-semibold ${isDarkMode ? "bg-slate-950/60 text-slate-200" : "bg-white/70 text-slate-700"}`}>
        Growth checkpoint: {Math.min(100, (stage + (accuracy >= 100 ? 0 : 0)) * 10)}%
      </div>
    </div>
  );
}
