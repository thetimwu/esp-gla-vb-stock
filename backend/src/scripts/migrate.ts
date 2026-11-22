import { AppDataSource } from "../config/dataSource.js";

try {
  await AppDataSource.initialize();
  const migrations = await AppDataSource.runMigrations();
  console.info(`Applied ${migrations.length} database migration(s).`);
} catch (error) {
  console.error("Database migration failed.");
  throw error;
} finally {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}
