import { useState } from "react";
import type { SignUpResult } from "../lib/auth";

type AuthPanelProps = {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, username: string, password: string) => Promise<SignUpResult>;
  initialMode?: "signin" | "signup";
  onBack?: () => void;
};

export default function AuthPanel({ onSignIn, onSignUp, initialMode = "signin", onBack }: AuthPanelProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await onSignIn(email, password);
      } else {
        const result = await onSignUp(email, username, password);
        if (result.requiresEmailConfirmation) {
          setNotice("Check your inbox and confirm your email before signing in.");
          setMode("signin");
          setPassword("");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] font-sans">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">

          {/* Left: marketing */}
          <div className="flex flex-col justify-center">
            <span className="font-display text-2xl italic text-[#1C1B18]">echoLearn</span>
            <h1 className="mt-6 text-4xl font-semibold leading-tight text-[#1C1B18]">
              Your progress,<br />saved to your account.
            </h1>
            <p className="mt-4 text-[#7A7570]">
              Sign in to keep your streak, question history, stats, and settings synced.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Growth buddy", desc: "A plant that grows with your accuracy." },
                { label: "Past attempts", desc: "Detailed per-question logs." },
                { label: "Saved settings", desc: "Difficulty and mode remembered." },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-[#E2E0DB] bg-white p-4">
                  <p className="font-medium text-[#1C1B18]">{item.label}</p>
                  <p className="mt-1 text-xs text-[#7A7570]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: form */}
          <div className="rounded-2xl border border-[#E2E0DB] bg-white p-8 shadow-sm">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mb-6 flex items-center gap-1.5 text-sm text-[#7A7570] transition-colors hover:text-[#1C1B18]"
              >
                ← Back
              </button>
            )}

            {/* Tabs */}
            <div className="flex rounded-lg border border-[#E2E0DB] p-1">
              {(["signin", "signup"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMode(tab)}
                  className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                    mode === tab
                      ? "bg-[#D4500A] text-white shadow-sm"
                      : "text-[#7A7570] hover:text-[#1C1B18]"
                  }`}
                >
                  {tab === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-[#1C1B18]">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="rounded-lg border border-[#E2E0DB] px-4 py-2.5 text-sm text-[#1C1B18] placeholder-[#B8B5AF] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
                />
              </label>

              {mode === "signup" && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-[#1C1B18]">Username</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="rounded-lg border border-[#E2E0DB] px-4 py-2.5 text-sm text-[#1C1B18] placeholder-[#B8B5AF] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
                  />
                </label>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-[#1C1B18]">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="rounded-lg border border-[#E2E0DB] px-4 py-2.5 text-sm text-[#1C1B18] placeholder-[#B8B5AF] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
                />
              </label>

              {error && (
                <div className="rounded-lg border border-[#C13030]/20 bg-[#FFF0F0] px-4 py-3 text-sm text-[#C13030]">
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-lg border border-[#2D6A4F]/20 bg-[#F0FFF6] px-4 py-3 text-sm text-[#2D6A4F]">
                  {notice}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 rounded-lg bg-[#D4500A] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B83D07] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting
                  ? "Working…"
                  : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
