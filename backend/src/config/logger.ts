import pino from "pino";

export function createLogger(level = process.env.LOG_LEVEL ?? "info") {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.url",
        "err.message",
        "err.stack",
        "password",
        "passwordHash",
        "DB_PASSWORD",
        "POSTGRES_ADMIN_PASSWORD",
        "database.password",
        "options.password",
      ],
      censor: "[REDACTED]",
    },
  });
}

export const logger = createLogger();
