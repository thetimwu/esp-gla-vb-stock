import { csrfSync } from "csrf-sync";

export const csrf = csrfSync({
  errorConfig: {
    statusCode: 403,
    code: "CSRF_TOKEN_INVALID",
    message: "Missing or invalid CSRF token",
  },
});

export const { csrfSynchronisedProtection, generateToken } = csrf;
