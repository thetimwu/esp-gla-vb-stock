import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { createComponentRouter } from "./routes/componentRoutes.js";
import { createPublicStatisticsController } from "./controllers/componentController.js";
import { createHealthRouter } from "./routes/healthRoutes.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import {
  createAdminRouter,
  createTransactionHistoryRouter,
} from "./routes/adminRoutes.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "./middleware/errorHandler.js";
import {
  componentReader,
  type ComponentReader,
} from "./services/componentService.js";
import { authService, type AuthService } from "./services/authService.js";
import { sessionMiddleware } from "./config/sessionStore.js";
import {
  componentAdminService,
  type ComponentAdminService,
} from "./services/componentAdminService.js";
import {
  userAdminService,
  type UserAdminService,
} from "./services/userAdminService.js";
import type { RequestHandler } from "express";
import { parseEnvironment } from "./config/env.js";
import {
  historyReader,
  type HistoryReader,
} from "./services/historyService.js";
import {
  stockOperationService,
  type StockOperationService,
} from "./services/stockOperationService.js";

export interface AppDependencies {
  checkDatabaseConnection(): Promise<void>;
  logger: Logger;
  componentReader?: ComponentReader;
  auth?: AuthService;
  componentAdmin?: ComponentAdminService;
  userAdmin?: UserAdminService;
  sessionHandler?: RequestHandler;
  historyReader?: HistoryReader;
  stockOperations?: StockOperationService;
}

export function createApp({
  checkDatabaseConnection,
  logger,
  componentReader: providedComponentReader = componentReader,
  auth = authService,
  componentAdmin = componentAdminService,
  userAdmin = userAdminService,
  sessionHandler = sessionMiddleware,
  historyReader: providedHistoryReader = historyReader,
  stockOperations = stockOperationService,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", parseEnvironment().TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "100kb" }));

  app.use(
    "/api/health",
    createHealthRouter({ checkDatabaseConnection, logger }),
  );
  app.use("/api/auth", sessionHandler, createAuthRouter(auth));
  app.use(
    "/api/components",
    createComponentRouter(
      providedComponentReader,
      auth,
      componentAdmin,
      sessionHandler,
      stockOperations,
    ),
  );
  app.get(
    "/api/statistics",
    createPublicStatisticsController(providedComponentReader),
  );
  app.use(
    "/api/transactions",
    createTransactionHistoryRouter(auth, sessionHandler, providedHistoryReader),
  );
  app.use(
    "/api/admin",
    createAdminRouter(
      auth,
      userAdmin,
      componentAdmin,
      sessionHandler,
      providedHistoryReader,
    ),
  );
  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
