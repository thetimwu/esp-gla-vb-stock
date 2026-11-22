import "reflect-metadata";
import { DataSource } from "typeorm";
import { parseEnvironment } from "./env.js";
import { AuditLog } from "../entities/AuditLog.js";
import { Component } from "../entities/Component.js";
import { StockTransaction } from "../entities/StockTransaction.js";
import { User } from "../entities/User.js";
import { InitialInventorySchema1710000000000 } from "../migrations/1710000000000-InitialInventorySchema.js";

const environment = parseEnvironment();

export const AppDataSource = new DataSource({
  type: "postgres",
  host: environment.DB_HOST,
  port: environment.DB_PORT,
  database: environment.DB_NAME,
  username: environment.DB_USER,
  password: environment.DB_PASSWORD,
  entities: [User, Component, StockTransaction, AuditLog],
  migrations: [InitialInventorySchema1710000000000],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  extra: {
    connectionTimeoutMillis: 10_000,
  },
});
