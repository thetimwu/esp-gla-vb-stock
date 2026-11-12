import session, { type Store } from "express-session";

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_MAX_AGE_MS / 1000;

export function createSessionMiddleware(
  secret: string,
  store: Store,
  httpsEnabled: boolean,
) {
  return session({
    name: "gate.sid",
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    proxy: httpsEnabled,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: httpsEnabled,
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}
