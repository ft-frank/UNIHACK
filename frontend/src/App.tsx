// src/App.tsx
import { useEffect, useRef, useState } from "react";
import type { Question } from "./questions";
import { fetchQuestionsForVideo } from "./questions";
import Settings, { type UserSettings } from "./components/settings";
import AuthModal from "./components/AuthModal";
import { supabase } from "./supabase";

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: any; }
}

export default function App() {
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const currentQuestionRef = useRef<Question | null>(null);

  const setQuestionState = (q: Question | null) => {
    setCurrentQuestion(q);
    currentQuestionRef.current = q;
  };

  const [session, setSession] = useState<any>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  }, []);

  useEffect(() => {
    if (!videoId || !window.YT) return;
    if (playerRef.current) playerRef.current.destroy();

    playerRef.current = new window.YT.Player("yt-player", {
      height: "100%",
      width: "100%",
      videoId,
      playerVars: { autoplay: 1, fs: 0 },
      events: {
        onReady: () => {
          playerRef.current.playVideo();
          startPolling();
        },
        onStateChange: (e: any) => {
          if (e.data === window.YT.PlayerState.PLAYING) {
            if (currentQuestionRef.current) {
              const currentTime = playerRef.current.getCurrentTime();
              if (currentTime < currentQuestionRef.current.timestamp - 0.5) {
                const activeTimestamp = currentQuestionRef.current.timestamp;
                setQuestionState(null);
                setFeedback(null);
                processedRef.current = processedRef.current.filter((t) => t !== activeTimestamp);
                startPolling();
              } else {
                playerRef.current.pauseVideo();
              }
            } else {
              startPolling();
            }
          } else {
            stopPolling();
          }
        },
      },
    });
    return () => stopPolling();
  }, [videoId]);

  const startPolling = () => {
    stopPolling();
    intervalRef.current = window.setInterval(() => {
      if (!playerRef.current) return;
      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      const question = questionsRef.current.find(
        (q) => currentTime >= q.timestamp && !processedRef.current.includes(q.timestamp)
      );
      if (question) {
        processedRef.current.push(question.timestamp);
        playerRef.current.pauseVideo();
        setQuestionState(question);
      }
    }, 200);
  };

  const stopPolling = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
  };

  const handleLoadVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    const fetchedData = await fetchQuestionsForVideo(urlInput, settings);
    questionsRef.current = fetchedData;
    const match = urlInput.match(/v=([a-zA-Z0-9_-]{11})/);
    if (match) setVideoId(match[1]);
    processedRef.current = [];
    setQuestionState(null);
    setFeedback(null);
    setScore(0);
  };

  const handleAnswerClick = (index: number) => {
    if (!currentQuestion) return;
    if (index === currentQuestion.answerIndex) {
      setFeedback("Correct!");
      setScore(prev => prev + 1);
    } else {
      setFeedback(`Incorrect. Answer: ${currentQuestion.choices[currentQuestion.answerIndex]}`);
    }
  };

  const continueVideo = () => {
    setQuestionState(null);
    setFeedback(null);
    playerRef.current?.playVideo();
    startPolling();
  };

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans">
      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} currentSettings={settings} onSave={(s) => setSettings(s)} />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />

      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h1 className="text-xl font-bold text-slate-800">YouTube Interactive Quiz</h1>
        <div className="flex items-center gap-3">
          {session ? (
            <button onClick={() => supabase.auth.signOut()} className="px-4 py-2 text-sm font-semibold text-rose-600 border border-gray-200 rounded-md hover:bg-rose-50 transition-colors">Sign Out</button>
          ) : (
            <button onClick={() => setIsAuthOpen(true)} className="px-4 py-2 text-sm font-semibold text-slate-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">Log In</button>
          )}
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
          </button>
        </div>
      </header>

      <div className="bg-[#f9fafb] px-6 py-4 border-b border-gray-100">
        <form onSubmit={handleLoadVideo} className="flex gap-4 items-center">
          <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="YouTube URL..." className="w-[480px] px-4 py-2 bg-gray-100/80 border border-gray-200 rounded-md focus:bg-white transition-colors outline-none text-sm" />
          <button type="submit" className="px-6 py-2 bg-[#0b0f19] text-white text-sm font-semibold rounded-md hover:bg-slate-800 transition-colors">Load Video</button>
        </form>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8">
          {videoId ? <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-sm border border-gray-200 relative"><div id="yt-player" className="absolute inset-0" /></div> : <div className="w-full aspect-video bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400">Load a video</div>}
        </div>
        <div className="lg:col-span-4">
          <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">Quiz</h2><span className="text-sm text-gray-500">Score: {score}</span></div>
          <div className="border border-gray-200 rounded-xl bg-slate-50/50 p-8 min-h-[160px] flex items-center justify-center text-center">
            {currentQuestion ? (
              <div>
                <h3 className="text-lg font-bold mb-5">{currentQuestion.question}</h3>
                {!feedback ? <div className="flex flex-col gap-3">{currentQuestion.choices.map((c, i) => <button key={i} onClick={() => handleAnswerClick(i)} className="w-full py-2 px-4 bg-white border border-gray-200 rounded-lg hover:border-slate-800 text-sm font-medium">{c}</button>)}</div> : <div className="flex flex-col gap-3"><p className={`font-bold ${feedback === "Correct!" ? "text-emerald-600" : "text-rose-600"}`}>{feedback}</p><button onClick={continueVideo} className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold">Continue</button></div>}
              </div>
            ) : <p className="text-gray-400">Pause the video to start</p>}
          </div>
        </div>
      </main>
    </div>
  );
}