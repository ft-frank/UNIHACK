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

  const playerRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  const processedRef = useRef<number[]>([]);
  
  // Ref to hold the dynamically fetched questions for the current video
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
    
    // FETCH DATA FIRST: Call your external function with the URL
    const fetchedData = await fetchQuestionsForVideo(urlInput);
    questionsRef.current = fetchedData;
    
    // THEN SET UP VIDEO: Parse the ID and trigger the player
    const match = urlInput.match(/v=([a-zA-Z0-9_-]{11})/);
    if (match) setVideoId(match[1]);
    
    // Reset states for the new video
    processedRef.current = [];
    setCurrentQuestion(null);
    setFeedback(null);
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