import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Store } from "express-session";
import type { Logger } from "pino";
import { createComponentRouter } from "./routes/componentRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createUserRouter } from "./routes/userRoutes.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "./middleware/errorHandler.js";
import { createSessionMiddleware } from "./middleware/session.js";
import {
  componentReader,
  type ComponentReader,
} from "./services/componentService.js";
import { authService, type AuthService } from "./services/authService.js";
import {
  userManagementService,
  type UserManagementService,
} from "./services/userManagementService.js";
import { csrfSynchronisedProtection } from "./middleware/csrf.js";

export interface AppDependencies {
  isDatabaseConnected(): boolean;
  logger: Logger;
  sessionSecret: string;
  sessionStore: Store;
  httpsEnabled: boolean;
  componentReader?: ComponentReader;
  authService?: AuthService;
  userManagementService?: UserManagementService;
  loginRateLimit?: number;
}

export function createApp({
  isDatabaseConnected,
  logger,
  sessionSecret,
  sessionStore,
  httpsEnabled,
  componentReader: providedComponentReader = componentReader,
  authService: providedAuthService = authService,
  userManagementService: providedUserManagementService = userManagementService,
  loginRateLimit,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", httpsEnabled ? 1 : false);
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "100kb" }));
  app.use(createSessionMiddleware(sessionSecret, sessionStore, httpsEnabled));

  app.use(csrfSynchronisedProtection);

  app.use("/api/health", createHealthRouter({ isDatabaseConnected }));
  app.use("/api/components", createComponentRouter(providedComponentReader));
  app.use("/api/auth", createAuthRouter(providedAuthService, loginRateLimit));
  app.use(
    "/api/users",
    createUserRouter(providedAuthService, providedUserManagementService),
  );
  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
