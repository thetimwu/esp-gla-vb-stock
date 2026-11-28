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
import {
  stockOperationService,
  type StockOperationService,
} from "../services/stockOperationService.js";
import { componentIdParamsSchema } from "../validators/componentValidators.js";
import { stockOperationSchema } from "../validators/stockValidators.js";
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
  stockOperations: StockOperationService = stockOperationService,
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
  router.post(
    "/:componentId/stock-transactions",
    sessionHandler,
    requireActiveUser(auth),
    verifyCsrfToken,
    validateParams(componentIdParamsSchema),
    async (request, response) => {
      const { componentId } = componentIdParamsSchema.parse(request.params);
      const operation = stockOperationSchema.parse(request.body);
      const transaction = await stockOperations.record(
        componentId,
        operation,
        request.user!.id,
      );
      response.status(201).json({ transaction });
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
