// AUTH DISABLED: import { ensureValidSession } from "./auth";

const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
let backendPathsPromise: Promise<Set<string>> | null = null;

const getBackendPaths = async (): Promise<Set<string>> => {
  if (!backendPathsPromise) {
    backendPathsPromise = fetch(`${apiBase}/openapi.json`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to inspect backend routes.");
        }

        const data = (await response.json()) as { paths?: Record<string, unknown> };
        return new Set(Object.keys(data.paths ?? {}));
      })
      .catch(() => new Set<string>());
  }

  return backendPathsPromise;
};

export const backendHasPath = async (path: string): Promise<boolean> => {
  const paths = await getBackendPaths();
  return paths.has(path);
};

export const apiFetch = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  // AUTH DISABLED: session not required; restore auth header when Supabase is connected
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? "Request failed");
  }

  return data as T;
};
