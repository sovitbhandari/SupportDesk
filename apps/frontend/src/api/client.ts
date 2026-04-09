const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

let accessToken: string | null = null;
let setTokenCallback: ((token: string | null) => void) | null = null;

export function bindAccessTokenStore(setter: (token: string | null) => void) {
  setTokenCallback = setter;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  setTokenCallback?.(token);
}

export function getAccessToken() {
  return accessToken;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public payload: unknown) {
    super(message);
  }
}

async function tryRefreshToken() {
  const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" }
  });

  if (!refreshResponse.ok) {
    setAccessToken(null);
    return false;
  }

  const data = (await refreshResponse.json()) as { token: string };
  setAccessToken(data.token);
  return true;
}

export async function apiRequest<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const makeRequest = async (bearer: string | null) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(init?.headers ?? {})
      }
    });

  const initialToken = token ?? accessToken;
  let response: Response;
  try {
    response = await makeRequest(initialToken);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ApiError(
      `Cannot reach API at ${API_BASE}. Is the backend running on port 4000? (${reason})`,
      0,
      null
    );
  }

  if (response.status === 401 && initialToken) {
    try {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        response = await makeRequest(accessToken);
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(
        `Cannot reach API at ${API_BASE}. Is the backend running on port 4000? (${reason})`,
        0,
        null
      );
    }
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.error ?? `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const apiBaseUrl = API_BASE;
