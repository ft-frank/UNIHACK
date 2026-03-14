export type AuthUser = {
  id: string;
  email: string;
  username: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
};

export type SignUpResult = {
  session: AuthSession | null;
  requiresEmailConfirmation: boolean;
};

type AuthPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user: {
    id: string;
    email: string;
    user_metadata?: {
      username?: string;
    };
  };
};

const STORAGE_KEY = "unihack.auth.session";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const emailRedirectTo = import.meta.env.VITE_AUTH_REDIRECT_URL ?? "";

const hasWindow = () => typeof window !== "undefined";

const mapAuthPayload = (payload: Required<Pick<AuthPayload, "access_token" | "refresh_token" | "expires_in">> & AuthPayload): AuthSession => ({
  accessToken: payload.access_token,
  refreshToken: payload.refresh_token,
  expiresAt: Date.now() + payload.expires_in * 1000,
  user: {
    id: payload.user.id,
    email: payload.user.email,
    username:
      payload.user.user_metadata?.username ||
      payload.user.email.split("@")[0] ||
      "friend",
  },
});

const authRequest = async <T>(
  path: string,
  init: RequestInit
): Promise<T> => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg ?? data.error_description ?? data.error ?? "Auth request failed");
  }

  return data as T;
};

export const getStoredSession = (): AuthSession | null => {
  if (!hasWindow()) return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const saveSession = (session: AuthSession | null) => {
  if (!hasWindow()) return;

  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

export const signUpWithEmail = async (
  email: string,
  password: string,
  username: string
): Promise<SignUpResult> => {
  const data = await authRequest<AuthPayload>("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      data: { username },
      ...(emailRedirectTo ? { email_redirect_to: emailRedirectTo } : {}),
    }),
  });

  if (data.access_token && data.refresh_token && data.expires_in) {
    const session = mapAuthPayload({
      ...data,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });
    saveSession(session);
    return {
      session,
      requiresEmailConfirmation: false,
    };
  }

  saveSession(null);
  return {
    session: null,
    requiresEmailConfirmation: true,
  };
};

export const signInWithEmail = async (
  email: string,
  password: string
): Promise<AuthSession> => {
  const data = await authRequest<AuthPayload>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!data.access_token || !data.refresh_token || !data.expires_in) {
    throw new Error("Sign-in did not return a valid session.");
  }

  const session = mapAuthPayload({
    ...data,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  });
  saveSession(session);
  return session;
};

export const refreshSession = async (
  session: AuthSession
): Promise<AuthSession | null> => {
  try {
    const data = await authRequest<AuthPayload>("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({
        refresh_token: session.refreshToken,
      }),
    });

    if (!data.access_token || !data.refresh_token || !data.expires_in) {
      throw new Error("Refresh did not return a valid session.");
    }

    const nextSession = mapAuthPayload({
      ...data,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });
    saveSession(nextSession);
    return nextSession;
  } catch {
    saveSession(null);
    return null;
  }
};

export const ensureValidSession = async (): Promise<AuthSession | null> => {
  const existing = getStoredSession();
  if (!existing) return null;

  if (existing.expiresAt > Date.now() + 60_000) {
    return existing;
  }

  return refreshSession(existing);
};

export const signOut = () => {
  saveSession(null);
};
