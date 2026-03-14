// App.tsx
import { useEffect, useRef, useState } from "react";
import type { Question } from "./questions";
import { fetchQuestionsForVideo } from "./questions";

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: any; }
}

export default function App() {
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const playerRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  const processedRef = useRef<number[]>([]);

  const questionsRef = useRef<Question[]>([]);

  // 1. Load YT API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  }, []);

  // 2. Initialize Player
  useEffect(() => {
    if (!videoId || !window.YT) return;
    if (playerRef.current) playerRef.current.destroy();

    playerRef.current = new window.YT.Player("yt-player", {
      height: "405",
      width: "720",
      videoId,
      playerVars: { origin: window.location.origin },
      events: {
        onReady: () => {
          playerRef.current.playVideo();
          startPolling();
        },
        onStateChange: (e: any) => {
          e.data === window.YT.PlayerState.PLAYING ? startPolling() : stopPolling();
        },
      },
    });

    return () => stopPolling();
  }, [videoId]);

  // 3. Polling Logic
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
        setCurrentQuestion(question);
      }
    }, 200);
  };

  const stopPolling = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
  };

  // 4. Handlers
  const handleLoadVideo = async (e: React.FormEvent) => {
    e.preventDefault();

    const match = urlInput.match(/v=([a-zA-Z0-9_-]{11})/);
    if (!match) return;

    // Show video immediately
    processedRef.current = [];
    setCurrentQuestion(null);
    setFeedback(null);
    setVideoId(match[1]);

    // Fetch questions in background
    setLoading(true);
    try {
      const fetchedData = await fetchQuestionsForVideo(urlInput);
      console.log("Questions from /questions:", fetchedData);
      questionsRef.current = fetchedData;
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerClick = (index: number) => {
    if (!currentQuestion) return;
    setFeedback(index === currentQuestion.answerIndex ? "Correct!" : `Incorrect. Answer: ${currentQuestion.choices[currentQuestion.answerIndex]}`);
  };

  const continueVideo = () => {
    setCurrentQuestion(null);
    setFeedback(null);
    playerRef.current?.playVideo();
    startPolling();
  };

  // 5. Render
  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>YouTube Interactive Quiz</h1>

      <form onSubmit={handleLoadVideo} style={{ marginBottom: 20 }}>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste YouTube URL"
          style={{ marginRight: 10, width: "300px", padding: "5px" }}
        />
        <button type="submit" style={{ padding: "5px 10px" }}>Load Video</button>
      </form>

      <div id="yt-player" />

      {loading && (
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 24, height: 24, border: "3px solid #ccc",
            borderTopColor: "#333", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <span>Generating questions...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {currentQuestion && (
        <div style={{ marginTop: 20 }}>
          <h2>{currentQuestion.question}</h2>

          {!feedback ? (
            currentQuestion.choices.map((c, i) => (
              <button key={i} onClick={() => handleAnswerClick(i)} style={{ marginRight: 10, padding: "8px" }}>
                {c}
              </button>
            ))
          ) : (
            <div>
              <p style={{ fontWeight: "bold", color: feedback === "Correct!" ? "green" : "red" }}>{feedback}</p>
              <button onClick={continueVideo} style={{ padding: "8px" }}>Continue Video</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
