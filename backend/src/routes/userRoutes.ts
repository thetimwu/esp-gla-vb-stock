import { Router } from "express";
import { createUserController } from "../controllers/userController.js";
import {
  requireAuthenticated,
  requirePasswordChanged,
  requireRole,
} from "../middleware/authentication.js";
import type { AuthService } from "../services/authService.js";
import type { UserManagementService } from "../services/userManagementService.js";

export function createUserRouter(
  authService: AuthService,
  userService: UserManagementService,
): Router {
  const router = Router();
  const controller = createUserController(userService);
  router.use(
    requireAuthenticated(authService),
    requirePasswordChanged,
    requireRole("Admin"),
  );
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.patch("/:userId", controller.update);
  router.post("/:userId/deactivate", controller.deactivate);
  router.post("/:userId/reactivate", controller.reactivate);
  return router;
}
