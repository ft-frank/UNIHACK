import { useState } from "react";
import type { SignUpResult } from "../lib/auth";

type AuthPanelProps = {
  isDarkMode: boolean;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, username: string, password: string) => Promise<SignUpResult>;
  initialMode?: "signin" | "signup";
  onBack?: () => void;
};

export default function AuthPanel({
  isDarkMode,
  onSignIn,
  onSignUp,
  initialMode = "signin",
  onBack,
}: AuthPanelProps) {
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
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
        <section
          className={`animate-fade-up rounded-[28px] border p-6 shadow-[0_26px_90px_rgba(15,23,42,0.2)] sm:rounded-[36px] sm:p-8 ${
            isDarkMode
              ? "border-slate-800 bg-slate-950/80 text-slate-100"
              : "border-slate-200 bg-white/85 text-slate-900"
          }`}
        >
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-400">
            Echolearn
          </p>
          <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-4xl">
            Your learning world, saved to your account
          </h1>
          <p className={`mt-4 max-w-xl text-base ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
            Sign in to keep your streak garden, question history, stats, settings, and progress synced in Supabase.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              "Daily streak garden",
              "Detailed past attempts",
              "Saved preferences and stats",
            ].map((item, index) => (
              <div
                key={item}
                className={`animate-fade-up rounded-[24px] border p-4 ${isDarkMode ? "border-slate-800 bg-slate-900/70" : "border-slate-200 bg-slate-50/80"}`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="text-3xl">{index === 0 ? "🌱" : index === 1 ? "📚" : "✨"}</div>
                <p className="mt-3 text-sm font-semibold">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          className={`animate-fade-up rounded-[28px] border p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:rounded-[32px] sm:p-8 ${
            isDarkMode
              ? "border-slate-800 bg-slate-900/80 text-slate-100"
              : "border-slate-200 bg-white/92 text-slate-900"
          }`}
        >
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className={`mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                isDarkMode
                  ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                  : "border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span aria-hidden="true">←</span>
              <span>Back to homepage</span>
            </button>
          )}

          <div className="flex rounded-full p-1 shadow-sm">
            {(["signin", "signup"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMode(tab)}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                  mode === tab
                    ? "bg-emerald-500 text-white shadow-[0_14px_24px_rgba(16,185,129,0.25)]"
                    : isDarkMode
                    ? "text-slate-300 hover:bg-slate-800"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className={`mb-2 block text-sm font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={`w-full rounded-2xl border px-4 py-3 text-sm ${
                  isDarkMode
                    ? "border-slate-700 bg-slate-950 text-slate-100"
                    : "border-slate-200 bg-white text-slate-900"
                }`}
                required
              />
            </label>

            {mode === "signup" && (
              <label className="block">
                <span className={`mb-2 block text-sm font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  Username
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm ${
                    isDarkMode
                      ? "border-slate-700 bg-slate-950 text-slate-100"
                      : "border-slate-200 bg-white text-slate-900"
                  }`}
                  required
                />
              </label>
            )}

            <label className="block">
              <span className={`mb-2 block text-sm font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`w-full rounded-2xl border px-4 py-3 text-sm ${
                  isDarkMode
                    ? "border-slate-700 bg-slate-950 text-slate-100"
                    : "border-slate-200 bg-white text-slate-900"
                }`}
                required
                minLength={6}
              />
            </label>

            {error && (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${isDarkMode ? "border-rose-900 bg-rose-950/40 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                {error}
              </div>
            )}

            {notice && (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${isDarkMode ? "border-emerald-900 bg-emerald-950/40 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="animate-pulse-glow w-full rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? "Working..."
                : mode === "signin"
                ? "Sign in to Echolearn"
                : "Create your Echolearn account"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
