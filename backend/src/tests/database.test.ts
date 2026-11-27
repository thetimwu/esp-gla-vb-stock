import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { checkDatabaseConnection } from "../config/database.js";
import { AppDataSource } from "../config/dataSource.js";
import { createLogger } from "../config/logger.js";
import { Component } from "../entities/Component.js";
import { componentReader } from "../services/componentService.js";

const logger = createLogger("silent");
const repository = AppDataSource.getRepository(Component);
const fixtureIds: string[] = [];

const app = createApp({
  checkDatabaseConnection,
  logger,
  componentReader,
});

beforeAll(async () => {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
});

beforeEach(async () => {
  const fixture = await repository.save(
    repository.create({
      name: `Database test component ${randomUUID()}`,
      description: "Test fixture",
      partNumber: null,
      currentQuantity: 4,
      minimumStockLevel: 2,
      photoPath: null,
      attributes: { internal: "must not be public" },
      isActive: true,
    }),
  );
  fixtureIds.push(fixture.id);
});

afterEach(async () => {
  if (fixtureIds.length > 0) {
    await repository.delete(fixtureIds.splice(0));
  }
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

describe("PostgreSQL-backed public API", () => {
  it("returns an empty component list when the PostgreSQL table is empty", async () => {
    await repository.delete(fixtureIds.splice(0));

    const response = await request(app).get("/api/components");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ components: [] });
  });

  it("checks a live PostgreSQL connection from the health endpoint", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "connected" });
  });

  it("creates PostgreSQL-backed session storage through a migration", async () => {
    const [sessionTable] = await AppDataSource.query(
      `SELECT to_regclass('public.sessions') AS table_name`,
    );

    expect(sessionTable.table_name).toBe("sessions");
  });

  it("lists active components from PostgreSQL with only public fields", async () => {
    const response = await request(app).get("/api/components");

    expect(response.status).toBe(200);
    expect(response.body.components).toContainEqual(
      expect.objectContaining({
        id: fixtureIds[fixtureIds.length - 1],
        displayName: expect.stringMatching(/^Database test component/),
        description: "Test fixture",
        currentQuantity: 4,
        minimumStockLevel: 2,
        photoUrl: null,
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("attributes");
    expect(JSON.stringify(response.body)).not.toContain("internal");
  });

  it("looks up a component and returns 404 for an unknown UUID", async () => {
    const id = fixtureIds[fixtureIds.length - 1];
    const found = await request(app).get(`/api/components/${id}`);
    const missing = await request(app).get(`/api/components/${randomUUID()}`);

    expect(found.status).toBe(200);
    expect(found.body.component.id).toBe(id);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("COMPONENT_NOT_FOUND");
  });

  it("enforces non-negative quantities in PostgreSQL", async () => {
    const invalid = repository.create({
      name: "Invalid negative quantity",
      description: "",
      partNumber: null,
      currentQuantity: -1,
      minimumStockLevel: 0,
      photoPath: null,
      attributes: {},
      isActive: true,
    });

    await expect(repository.save(invalid)).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: "23514" }),
    });
  });
});
