import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { createComponentRouter } from "./routes/componentRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "./middleware/errorHandler.js";
import {
  componentReader,
  type ComponentReader,
} from "./services/componentService.js";

export interface AppDependencies {
  checkDatabaseConnection(): Promise<void>;
  logger: Logger;
  componentReader?: ComponentReader;
}

export function createApp({
  checkDatabaseConnection,
  logger,
  componentReader: providedComponentReader = componentReader,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "100kb" }));

  app.use(
    "/api/health",
    createHealthRouter({ checkDatabaseConnection, logger }),
  );
  app.use("/api/components", createComponentRouter(providedComponentReader));
  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
