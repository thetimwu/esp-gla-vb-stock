import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createLogger } from "../config/logger.js";
import type {
  ComponentReader,
  PublicComponent,
} from "../services/componentService.js";

const logger: Logger = createLogger("silent");

const component: PublicComponent = {
  id: "8a03ff64-6c8a-4b79-92e1-7104747064fd",
  displayName: "Example component",
  description: "A non-sensitive component description",
  currentQuantity: 4,
  minimumStockLevel: 2,
  photoUrl: null,
};

function createTestApp(
  overrides: {
    connected?: boolean;
    components?: PublicComponent[];
    detail?: PublicComponent | null;
  } = {},
) {
  const components = overrides.components ?? [];
  const reader: ComponentReader = {
    listPublic: vi.fn(async () => components),
    findPublicById: vi.fn(async () => overrides.detail ?? null),
  };
  const app = createApp({
    checkDatabaseConnection: async () => {
      if (overrides.connected === false) {
        throw new Error("database unavailable");
      }
    },
    logger,
    componentReader: reader,
  });
  return { app, reader };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("reports application and database readiness without internals", async () => {
    const { app } = createTestApp({ connected: true });

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "connected" });
    expect(JSON.stringify(response.body)).not.toContain("postgres");
  });

  it("returns 503 when the database is disconnected", async () => {
    const { app } = createTestApp({ connected: false });

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "unavailable",
      database: "disconnected",
    });
  });
});

describe("public component endpoints", () => {
  it("returns an empty array without requiring authentication", async () => {
    const { app, reader } = createTestApp();

    const response = await request(app).get("/api/components");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ components: [] });
    expect(reader.listPublic).toHaveBeenCalledOnce();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("supports the trailing-slash collection URL", async () => {
    const { app } = createTestApp({ components: [component] });

    const response = await request(app).get("/api/components/");

    expect(response.status).toBe(200);
    expect(response.body.components).toEqual([component]);
  });

  it("returns only public component details without authentication", async () => {
    const { app } = createTestApp({ detail: component });

    const response = await request(app).get(`/api/components/${component.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ component });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects malformed UUIDs before querying PostgreSQL", async () => {
    const { app, reader } = createTestApp();

    const response = await request(app).get("/api/components/not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(reader.findPublicById).not.toHaveBeenCalled();
    expect(response.body).not.toHaveProperty("stack");
  });

  it("returns 404 for a valid UUID with no matching component", async () => {
    const { app } = createTestApp();

    const response = await request(app).get(
      "/api/components/8a03ff64-6c8a-4b79-92e1-7104747064fd",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COMPONENT_NOT_FOUND");
    expect(response.body).not.toHaveProperty("stack");
  });

  it("returns a safe error response when component storage fails", async () => {
    const reader: ComponentReader = {
      listPublic: vi
        .fn()
        .mockRejectedValue(new Error("private database detail")),
      findPublicById: vi.fn().mockResolvedValue(null),
    };
    const app = createApp({
      checkDatabaseConnection: async () => {},
      logger,
      componentReader: reader,
    });

    const response = await request(app).get("/api/components");

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe("An unexpected error occurred");
    expect(JSON.stringify(response.body)).not.toContain(
      "private database detail",
    );
  });
});

describe("configuration validation", () => {
  it("rejects invalid database ports and missing database credentials", async () => {
    const { parseEnvironment } = await import("../config/env.js");

    expect(() =>
      parseEnvironment({
        PORT: "70000",
        DB_PORT: "70000",
        DB_NAME: "",
        DB_USER: "inventory",
        DB_PASSWORD: "secret",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
