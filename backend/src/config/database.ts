import { AppDataSource } from "./dataSource.js";

export async function connectToDatabase(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

export async function checkDatabaseConnection(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    throw new Error("Database connection is not initialized");
  }
  await AppDataSource.query("SELECT 1");
}
