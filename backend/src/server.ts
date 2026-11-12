import type { Server } from "node:http";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import { createApp } from "./app.js";
import { SESSION_TTL_SECONDS } from "./middleware/session.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
  isDatabaseConnected,
} from "./config/database.js";
import { parseEnvironment } from "./config/env.js";
import { logger } from "./config/logger.js";

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startServer(): Promise<void> {
  const environment = parseEnvironment();
  await connectToDatabase(environment.MONGODB_URI);
  const sessionStore = MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: "sessions",
    ttl: SESSION_TTL_SECONDS,
    autoRemove: "native",
    touchAfter: 60,
  });

  const app = createApp({
    isDatabaseConnected,
    logger,
    sessionSecret: environment.SESSION_SECRET,
    sessionStore,
    httpsEnabled: environment.HTTPS_ENABLED,
  });

  const server = app.listen(environment.PORT, () => {
    logger.info({ port: environment.PORT }, "Inventory API listening");
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    void closeServer(server)
      .then(() => sessionStore.close())
      .then(disconnectFromDatabase)
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "Graceful shutdown failed");
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void startServer().catch(async (error: unknown) => {
  logger.fatal({ err: error }, "Unable to start Inventory API");
  await disconnectFromDatabase();
  process.exitCode = 1;
});
