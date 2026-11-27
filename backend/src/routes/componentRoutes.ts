import { Router } from "express";
import {
  createGetComponentController,
  createListComponentsController,
} from "../controllers/componentController.js";
import { validateParams } from "../middleware/validate.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  requireActiveUser,
  requireAdmin,
  verifyCsrfToken,
} from "../middleware/authentication.js";
import type { AuthService } from "../services/authService.js";
import type { ComponentAdminService } from "../services/componentAdminService.js";
import type { ComponentReader } from "../services/componentService.js";
import { componentIdParamsSchema } from "../validators/componentValidators.js";
import {
  componentAdminIdParamsSchema,
  createComponentSchema,
  updateComponentSchema,
} from "../validators/adminValidators.js";
import type { RequestHandler } from "express";
import { sessionMiddleware } from "../config/sessionStore.js";

export function createComponentRouter(
  componentReader: ComponentReader,
  auth: AuthService,
  manager: ComponentAdminService,
  sessionHandler: RequestHandler = sessionMiddleware,
): Router {
  const router = Router();

  router.get("/", createListComponentsController(componentReader));
  router.post(
    "/",
    sessionHandler,
    requireActiveUser(auth),
    requireAdmin,
    verifyCsrfToken,
    validateBody(createComponentSchema),
    async (request, response) => {
      const component = await manager.create(request.body, request.user!.id);
      response.status(201).json({ component });
    },
  );
  router.get(
    "/:componentId",
    validateParams(componentIdParamsSchema),
    createGetComponentController(componentReader),
  );
  router.patch(
    "/:componentId",
    sessionHandler,
    requireActiveUser(auth),
    requireAdmin,
    verifyCsrfToken,
    validateParams(componentAdminIdParamsSchema),
    validateBody(updateComponentSchema),
    async (request, response) => {
      const { componentId } = componentAdminIdParamsSchema.parse(
        request.params,
      );
      const component = await manager.update(
        componentId,
        request.body,
        request.user!.id,
      );
      response.status(200).json({ component });
    },
  );

  return router;
}
