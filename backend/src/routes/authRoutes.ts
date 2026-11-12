import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthController } from "../controllers/authController.js";
import { requireAuthenticated } from "../middleware/authentication.js";
import type { AuthService } from "../services/authService.js";

export function createAuthRouter(
  authService: AuthService,
  loginLimit = 10,
): Router {
  const router = Router();
  const controller = createAuthController(authService);
  const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
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

  router.get("/csrf-token", controller.csrfToken);
  router.post("/login", loginRateLimit, controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", controller.me);
  router.post(
    "/password-change",
    requireAuthenticated(authService),
    controller.changePassword,
  );
  return router;
}
