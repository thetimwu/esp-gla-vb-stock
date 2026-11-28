import { useEffect, useState, type FormEvent } from "react";
import {
  AuthenticationApiError,
  fetchCsrfToken,
  login,
  type AuthUser,
} from "../api/authApi";

type CsrfState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; token: string };

function getLoginError(error: unknown): string {
  if (error instanceof AuthenticationApiError) {
    if (error.status === 401) {
      return "Incorrect username or password.";
    }
    if (error.status === 403) {
      return "Your sign-in request could not be verified. Please try again.";
    }
    if (error.status === 429) {
      return error.message;
    }
    return error.message;
  }
  return "Unable to sign in. Please try again.";
}

export default function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthUser, csrfToken: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [csrfAttempt, setCsrfAttempt] = useState(0);
  const [csrfState, setCsrfState] = useState<CsrfState>({
    status: "loading",
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetchCsrfToken(controller.signal)
      .then((token) => setCsrfState({ status: "ready", token }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCsrfState({
            status: "error",
            message: getLoginError(error),
          });
        }
      });

    return () => controller.abort();
  }, [csrfAttempt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!username.trim()) {
      setErrorMessage("Enter your username.");
      return;
    }
    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }
    if (csrfState.status !== "ready") {
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(username.trim(), password, csrfState.token);
      setPassword("");
      onAuthenticated(result.user, result.csrfToken);
    } catch (error) {
      setErrorMessage(getLoginError(error));
      if (error instanceof AuthenticationApiError && error.status === 403) {
        setCsrfState({ status: "loading" });
        setCsrfAttempt((attempt) => attempt + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-main">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Protected features</p>
        <h1 id="login-title">Sign in</h1>
        <p className="auth-card__description">
          Sign in with an account provided by your administrator. The stock
          dashboard remains available without signing in.
        </p>

        {csrfState.status === "error" && (
          <div className="auth-error" role="alert">
            <p>{csrfState.message}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setCsrfState({ status: "loading" });
                setCsrfAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}

        <form
          className="login-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            autoComplete="username"
            maxLength={100}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            maxLength={200}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {errorMessage && (
            <p className="auth-error-message" role="alert">
              {errorMessage}
            </p>
          )}

          {csrfState.status === "loading" && (
            <p className="auth-loading" role="status" aria-live="polite">
              <span className="loading-indicator" aria-hidden="true" />
              Preparing secure sign-in…
            </p>
          )}

          <button
            className="button button--primary login-form__submit"
            type="submit"
            disabled={submitting || csrfState.status !== "ready"}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <a className="auth-return-link" href="#top">
          Return to public dashboard
        </a>
      </section>
    </main>
  );
}
