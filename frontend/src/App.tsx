import { useEffect, useRef, useState } from "react";

type Question = {
  timestamp: number;
  question: string;
  choices: string[];
  answerIndex: number;
};

const mockData: Question[] = [
  { timestamp: 5, question: "How many fingers?", choices: ["3", "10", "4"], answerIndex: 1 },
  { timestamp: 15, question: "What is 2 + 2?", choices: ["3", "4", "5"], answerIndex: 1 },
];

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: any;
  }
}

export default function App() {
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState("");
  
  // Refs for managing player state and intervals
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  
  // THE FIX: Use a ref instead of state to track processed questions
  const processedRef = useRef<number[]>([]);

  // UI State
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Load YouTube API once
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  }, []);

  // Initialize player whenever videoId changes
  useEffect(() => {
    if (!videoId || !window.YT) return;

    // Destroy previous player if exists
    if (playerRef.current) {
      playerRef.current.destroy();
    }

    playerRef.current = new window.YT.Player("yt-player", {
      height: "405",
      width: "720",
      videoId,
      events: {
        onReady: () => {
          playerRef.current.playVideo();
          startPolling();
        },
        onStateChange: (event: any) => {
          if (event.data === window.YT.PlayerState.PLAYING) startPolling();
          if (event.data !== window.YT.PlayerState.PLAYING) stopPolling();
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
      
      // Use processedRef.current to avoid stale closures
      const question = mockData.find(
        (q) => currentTime >= q.timestamp && !processedRef.current.includes(q.timestamp)
      );
      
      if (question) {
        // Push directly to the ref so it's instantly tracked
        processedRef.current.push(question.timestamp);

        playerRef.current.pauseVideo();
        setCurrentQuestion(question);
      }
    }, 200);
  };

  const stopPolling = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
  };

  const handleLoadVideo = (e: React.FormEvent) => {
    e.preventDefault();
    const match = urlInput.match(/v=([a-zA-Z0-9_-]{11})/);
    if (match) setVideoId(match[1]);
    
    // Reset the processed ref for the new video
    processedRef.current = [];
    
    setCurrentQuestion(null);
    setFeedback(null);
  };

  const handleAnswerClick = (index: number) => {
    if (!currentQuestion) return;
    if (index === currentQuestion.answerIndex) setFeedback("Correct!");
    else setFeedback(`Incorrect. Correct answer: ${currentQuestion.choices[currentQuestion.answerIndex]}`);
  };

  const continueVideo = () => {
    setCurrentQuestion(null);
    setFeedback(null);
    if (playerRef.current) playerRef.current.playVideo();
    startPolling();
  };

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>YouTube Interactive Quiz</h1>
      <form onSubmit={handleLoadVideo}>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste YouTube URL"
          style={{ marginRight: 10, width: "300px", padding: "5px" }}
        />
        <button type="submit" style={{ padding: "5px 10px" }}>Load Video</button>
      </form>

      <div id="yt-player" style={{ marginTop: 20 }} />

      {currentQuestion && (
        <div style={{ marginTop: 20 }}>
          <h2>{currentQuestion.question}</h2>
          {!feedback ? (
            <div>
              {currentQuestion.choices.map((c, i) => (
                <button 
                  key={i} 
                  onClick={() => handleAnswerClick(i)} 
                  style={{ marginRight: 10, marginTop: 10, padding: "10px" }}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <div>
              <p style={{ fontWeight: "bold", color: feedback === "Correct!" ? "green" : "red" }}>
                {feedback}
              </p>
              <button onClick={continueVideo} style={{ padding: "10px", marginTop: "10px" }}>
                Continue Video
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}