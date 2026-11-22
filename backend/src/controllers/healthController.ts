import type { RequestHandler } from "express";
import type { Logger } from "pino";

export interface HealthControllerDependencies {
  checkDatabaseConnection(): Promise<void>;
  logger: Logger;
}

export function createHealthController({
  checkDatabaseConnection,
  logger,
}: HealthControllerDependencies): RequestHandler {
  return async (_request, response) => {
    let databaseConnected = true;
    try {
      await checkDatabaseConnection();
    } catch {
      logger.warn("Database health check failed");
      databaseConnected = false;
    }
    response.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? "ok" : "unavailable",
      database: databaseConnected ? "connected" : "disconnected",
    });
  };
}
