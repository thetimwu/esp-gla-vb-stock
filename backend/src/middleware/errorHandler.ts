import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { ApiError } from "../errors/ApiError.js";

interface ApiErrorLike extends Error {
  status?: number;
  type?: string;
}

export function createNotFoundHandler(): (
  request: Request,
  response: Response,
  next: NextFunction,
) => void {
  return (request, _response, next) => {
    const error = new Error(
      `Route not found: ${request.method} ${request.path}`,
    );
    Object.assign(error, { status: 404, code: "ROUTE_NOT_FOUND" });
    next(error);
  };
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    void _next;
    if (response.headersSent) {
      return;
    }

    const apiError: ApiErrorLike =
      error instanceof Error ? error : new Error("Unknown request error");
    const errorProperties =
      typeof error === "object" && error !== null
        ? (error as {
            code?: unknown;
            message?: unknown;
            status?: unknown;
            type?: unknown;
          })
        : {};
    const validationError = error instanceof ZodError;
    const malformedJson = errorProperties.type === "entity.parse.failed";
    const oversizedBody = errorProperties.type === "entity.too.large";
    const candidateStatus =
      typeof errorProperties.status === "number"
        ? errorProperties.status
        : undefined;
    const customCode =
      typeof errorProperties.code === "string"
        ? errorProperties.code
        : undefined;
    const csrfError =
      customCode === "CSRF_TOKEN_INVALID" ||
      (typeof errorProperties.message === "string" &&
        errorProperties.message === "invalid csrf token");
    const statusCode = validationError
      ? 400
      : malformedJson
        ? 400
        : oversizedBody
          ? 413
          : error instanceof ApiError
            ? error.status
            : csrfError
              ? 403
              : candidateStatus !== undefined &&
                  candidateStatus >= 400 &&
                  candidateStatus <= 599
                ? candidateStatus
                : 500;
    const code = validationError
      ? "VALIDATION_ERROR"
      : malformedJson
        ? "INVALID_JSON"
        : oversizedBody
          ? "REQUEST_TOO_LARGE"
          : csrfError
            ? "CSRF_TOKEN_INVALID"
            : error instanceof ApiError
              ? error.code
              : (customCode ??
                (statusCode === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR"));
    const message =
      statusCode >= 500
        ? "An unexpected error occurred"
        : validationError
          ? error.issues.map((issue) => issue.message).join(", ")
          : malformedJson
            ? "Request body contains invalid JSON"
            : oversizedBody
              ? "Request body is too large"
              : csrfError
                ? "Missing or invalid CSRF token"
                : statusCode === 404
                  ? "Resource not found"
                  : apiError.message;

    if (statusCode >= 500) {
      logger.error(
        { err: error, method: request.method, path: request.path },
        "Request failed",
      );
    }

    response.status(statusCode).json({ error: { code, message } });
  };
}
