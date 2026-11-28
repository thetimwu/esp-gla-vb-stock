import { apiBaseUrl } from "./config";

export type AuthRole = "ADMIN" | "ENGINEER";

export interface AuthUser {
  id: string;
  username: string;
  role: AuthRole;
}

export class AuthenticationApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "AuthenticationApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUser(value: unknown): AuthUser {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.username !== "string" ||
    (value.role !== "ADMIN" && value.role !== "ENGINEER")
  ) {
    throw new AuthenticationApiError(
      "The authentication service returned an unexpected user response.",
      0,
      "INVALID_RESPONSE",
    );
  }

  return {
    id: value.id,
    username: value.username,
    role: value.role,
  };
}

interface AuthRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

async function request(
  path: string,
  options: AuthRequestOptions = {},
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: options.body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    throw new AuthenticationApiError(
      "Unable to reach the authentication service. Check your connection and try again.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (response.status === 204) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AuthenticationApiError(
      "The authentication service returned an unreadable response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!response.ok) {
    const error = isRecord(payload) ? payload.error : undefined;
    const message = isRecord(error) ? error.message : undefined;
    const code =
      isRecord(error) && typeof error.code === "string" ? error.code : null;
    throw new AuthenticationApiError(
      typeof message === "string"
        ? message
        : "Authentication failed. Please try again.",
      response.status,
      code,
    );
  }

  return payload;
}

export async function fetchCsrfToken(signal?: AbortSignal): Promise<string> {
  const payload = await request("/auth/csrf-token", {
    ...(signal ? { signal } : {}),
  });
  if (!isRecord(payload) || typeof payload.csrfToken !== "string") {
    throw new AuthenticationApiError(
      "The authentication service returned an unexpected CSRF response.",
      0,
      "INVALID_RESPONSE",
    );
  }
  return payload.csrfToken;
}

export async function fetchCurrentSession(
  signal?: AbortSignal,
): Promise<AuthUser | null> {
  const payload = await request("/auth/session", {
    ...(signal ? { signal } : {}),
  });
  if (!isRecord(payload) || !("user" in payload)) {
    throw new AuthenticationApiError(
      "The authentication service returned an unexpected session response.",
      0,
      "INVALID_RESPONSE",
    );
  }
  return payload.user === null ? null : parseUser(payload.user);
}

export interface LoginResult {
  user: AuthUser;
  csrfToken: string;
}

export async function login(
  username: string,
  password: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<LoginResult> {
  const payload = await request("/auth/login", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ username, password }),
    ...(signal ? { signal } : {}),
  });

  if (
    !isRecord(payload) ||
    typeof payload.csrfToken !== "string" ||
    !("user" in payload)
  ) {
    throw new AuthenticationApiError(
      "The authentication service returned an unexpected login response.",
      0,
      "INVALID_RESPONSE",
    );
  }

  return {
    user: parseUser(payload.user),
    csrfToken: payload.csrfToken,
  };
}

export async function logout(csrfToken: string): Promise<void> {
  await request("/auth/logout", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
  });
}
