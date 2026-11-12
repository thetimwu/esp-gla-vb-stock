import type { RequestHandler } from "express";
import { ApiError } from "../errors/ApiError.js";
import type {
  AuthenticatedUser,
  AuthService,
} from "../services/authService.js";

declare module "express-serve-static-core" {
  interface Request {
    authenticatedUser?: AuthenticatedUser;
  }
}

export function requireAuthenticated(authService: AuthService): RequestHandler {
  return async (request, _response, next) => {
    if (!request.session.userId) {
      next(
        new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication required"),
      );
      return;
    }

    const user = await authService.findActiveUser(request.session.userId);
    if (!user) {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      next(
        new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication required"),
      );
      return;
    }
    request.authenticatedUser = user;
    next();
  };
}

export function requireRole(role: "Admin"): RequestHandler {
  return (request, _response, next) => {
    if (request.authenticatedUser?.role !== role) {
      next(new ApiError(403, "FORBIDDEN", "Administrator role required"));
      return;
    }
    next();
  };
}

export const requirePasswordChanged: RequestHandler = (
  request,
  _response,
  next,
) => {
  if (request.authenticatedUser?.passwordChangeRequired) {
    next(
      new ApiError(
        403,
        "PASSWORD_CHANGE_REQUIRED",
        "Change the initial password before continuing",
      ),
    );
    return;
  }
  next();
};
