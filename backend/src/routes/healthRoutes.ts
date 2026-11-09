import { Router } from "express";
import {
  createHealthController,
  type HealthControllerDependencies,
} from "../controllers/healthController.js";

export function createHealthRouter(
  dependencies: HealthControllerDependencies,
): Router {
  const router = Router();
  router.get("/", createHealthController(dependencies));
  return router;
}
