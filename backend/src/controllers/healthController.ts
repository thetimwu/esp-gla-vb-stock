import type { RequestHandler } from "express";

export interface HealthControllerDependencies {
  isDatabaseConnected(): boolean;
}

export function createHealthController({
  isDatabaseConnected,
}: HealthControllerDependencies): RequestHandler {
  return (_request, response) => {
    const databaseConnected = isDatabaseConnected();
    response.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? "ok" : "unavailable",
      database: databaseConnected ? "connected" : "disconnected",
    });
  };
}
