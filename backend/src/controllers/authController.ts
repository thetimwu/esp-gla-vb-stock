import type { Request, RequestHandler } from "express";
import { generateToken } from "../middleware/csrf.js";
import type { AuthService } from "../services/authService.js";
import {
  changePasswordBodySchema,
  emptyObjectSchema,
  loginBodySchema,
} from "../validators/authValidators.js";
import { ApiError } from "../errors/ApiError.js";

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function getCsrfToken(request: Request, overwrite = false): string {
  return generateToken(request, overwrite);
}

function publicUser(user: {
  id: string;
  username: string;
  role: string;
  passwordChangeRequired: boolean;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    passwordChangeRequired: user.passwordChangeRequired,
  };
}

export function createAuthController(authService: AuthService) {
  const csrfToken: RequestHandler = (request, response) => {
    response.status(200).json({ csrfToken: getCsrfToken(request) });
  };

  const login: RequestHandler = async (request, response) => {
    const input = loginBodySchema.parse(request.body);
    const user = await authService.authenticate(input.username, input.password);
    if (!user) {
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid username or password",
      );
    }

    await regenerateSession(request);
    request.session.userId = user.id;
    const csrfToken = getCsrfToken(request, true);
    await saveSession(request);
    response.status(200).json({ user: publicUser(user), csrfToken });
  };

  const me: RequestHandler = async (request, response) => {
    if (!request.session.userId) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication required",
      );
    }
    const user = await authService.findActiveUser(request.session.userId);
    if (!user) {
      await destroySession(request);
      response.clearCookie("gate.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: request.secure,
      });
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication required",
      );
    }
    response.status(200).json({ user: publicUser(user) });
  };

  const logout: RequestHandler = async (request, response) => {
    emptyObjectSchema.parse(request.body ?? {});
    await destroySession(request);
    response.clearCookie("gate.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: request.secure,
    });
    response.status(200).json({ message: "Logged out" });
  };

  const changePassword: RequestHandler = async (request, response) => {
    const input = changePasswordBodySchema.parse(request.body);
    const user = request.authenticatedUser;
    if (!user) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication required",
      );
    }

    const changed = await authService.changePassword(
      user.id,
      input.currentPassword,
      input.newPassword,
    );
    if (!changed) {
      throw new ApiError(
        400,
        "CURRENT_PASSWORD_INVALID",
        "Current password is incorrect",
      );
    }

    await regenerateSession(request);
    request.session.userId = user.id;
    const csrfToken = getCsrfToken(request, true);
    await saveSession(request);
    response.status(200).json({
      user: { ...publicUser(user), passwordChangeRequired: false },
      csrfToken,
    });
  };

  return { csrfToken, login, me, logout, changePassword };
}
