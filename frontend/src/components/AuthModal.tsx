// src/components/AuthModal.tsx
import { useState } from "react";
import { supabase } from "../supabase";

type AuthModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAuth = async (type: 'SIGNIN' | 'SIGNUP') => {
    if (!email || !password) return setError("Please enter email and password");
    
    setLoading(true);
    setError(null);
    setMessage(null);
    
    try {
      const { error: supabaseError } = type === 'SIGNIN' 
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

      if (supabaseError) throw supabaseError;

      if (type === 'SIGNUP') {
        setMessage("Success! Please check your email to confirm your account.");
      } else {
        onClose(); // Close modal on successful login
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4 font-sans">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-lg font-bold text-slate-800">Account</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-tight">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-800 text-sm text-slate-800"
              placeholder="you@example.com"
            />
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-tight">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-800 text-sm text-slate-800"
              placeholder="••••••••"
            />
          </div>

          {error && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">{error}</div>}
          {message && <div className="text-xs text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">{message}</div>}

          <div className="flex gap-3 pt-2">
            <button 
              onClick={() => handleAuth('SIGNIN')} 
              disabled={loading} 
              className="flex-1 px-4 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-all"
            >
              {loading ? "..." : "Sign In"}
            </button>
            <button 
              onClick={() => handleAuth('SIGNUP')} 
              disabled={loading} 
              className="flex-1 px-4 py-2.5 bg-white text-slate-800 border border-gray-200 text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-all"
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}