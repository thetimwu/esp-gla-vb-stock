import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { ApiError } from "../errors/ApiError.js";
import type { AuthService } from "../services/authService.js";
import { UserRole } from "../entities/User.js";

export function createCsrfTokenController(): RequestHandler {
  return (request, response) => {
    request.session.csrfToken ??= randomBytes(32).toString("hex");
    response.status(200).json({ csrfToken: request.session.csrfToken });
  };
}

export const verifyCsrfToken: RequestHandler = (request, _response, next) => {
  const expected = request.session.csrfToken;
  const received = request.get("x-csrf-token");
  if (
    !expected ||
    !received ||
    Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  ) {
    next(
      new ApiError(403, "CSRF_TOKEN_INVALID", "Missing or invalid CSRF token"),
    );
    return;
  }
  next();
};

export function requireActiveUser(auth: AuthService): RequestHandler {
  return async (request, _response, next) => {
    const userId = request.session.userId;
    if (!userId) {
      next(new ApiError(401, "AUTHENTICATION_REQUIRED", "Login required"));
      return;
    }

    const user = await auth.findActiveById(userId);
    if (!user) {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      next(new ApiError(401, "AUTHENTICATION_REQUIRED", "Login required"));
      return;
    }
    request.user = user;
    next();
  };
}

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (request.user?.role !== UserRole.ADMIN) {
    next(new ApiError(403, "FORBIDDEN", "Administrator access required"));
    return;
  }
  next();
};
