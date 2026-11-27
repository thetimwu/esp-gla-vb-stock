import { randomBytes } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "../errors/ApiError.js";
import {
  createCsrfTokenController,
  requireActiveUser,
  verifyCsrfToken,
} from "../middleware/authentication.js";
import type { AuthService } from "../services/authService.js";

const credentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
  })
  .strict();

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: "LOGIN_RATE_LIMITED",
          message: "Too many login attempts. Try again later.",
        },
      });
    },
  });

  router.get("/csrf-token", createCsrfTokenController());
  router.post(
    "/login",
    loginLimiter,
    verifyCsrfToken,
    async (request, response) => {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) {
        throw parsed.error;
      }

      const user = await auth.authenticate(
        parsed.data.username,
        parsed.data.password,
      );
      if (!user) {
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid username or password",
        );
      }

      await new Promise<void>((resolve, reject) => {
        request.session.regenerate((error) =>
          error ? reject(error) : resolve(),
        );
      });
      request.session.userId = user.id;
      request.session.csrfToken = randomBytes(32).toString("hex");
      response.status(200).json({ user, csrfToken: request.session.csrfToken });
    },
  );

  router.get("/session", async (request, response) => {
    if (!request.session.userId) {
      response.status(200).json({ user: null });
      return;
    }
    const user = await auth.findActiveById(request.session.userId);
    if (!user) {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      response.status(200).json({ user: null });
      return;
    }
    response.status(200).json({ user });
  });

  router.post(
    "/logout",
    verifyCsrfToken,
    requireActiveUser(auth),
    async (request, response) => {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      response.clearCookie("gate_inventory.sid", {
        path: "/",
      });
      response.status(204).end();
    },
  );
  return router;
}
