import { Router } from "express";
import {
  createGetComponentController,
  createListComponentsController,
} from "../controllers/componentController.js";
import { validateParams } from "../middleware/validate.js";
import type { ComponentReader } from "../services/componentService.js";
import { componentIdParamsSchema } from "../validators/componentValidators.js";

export function createComponentRouter(
  componentReader: ComponentReader,
): Router {
  const router = Router();

  router.get("/", createListComponentsController(componentReader));
  router.get(
    "/:componentId",
    validateParams(componentIdParamsSchema),
    createGetComponentController(componentReader),
  );

  return router;
}
