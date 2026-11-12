import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import session from "express-session";
import { createApp } from "../app.js";
import { createLogger } from "../config/logger.js";
import type { AuthService } from "../services/authService.js";
import type { UserManagementService } from "../services/userManagementService.js";
import type {
  ComponentReader,
  PublicComponent,
} from "../services/componentService.js";

const logger: Logger = createLogger("silent");

const component: PublicComponent = {
  id: "507f1f77bcf86cd799439011",
  displayName: "Example component",
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
  const authService: AuthService = {
    authenticate: vi.fn(async () => null),
    findActiveUser: vi.fn(async () => null),
    changePassword: vi.fn(async () => false),
  };
  const userManagementService: UserManagementService = {
    listUsers: vi.fn(async () => []),
    createUser: vi.fn(async () => {
      throw new Error("Not implemented in this test");
    }),
    updateUser: vi.fn(async () => {
      throw new Error("Not implemented in this test");
    }),
    setUserActive: vi.fn(async () => {
      throw new Error("Not implemented in this test");
    }),
  };
  const app = createApp({
    isDatabaseConnected: () => overrides.connected ?? true,
    logger,
    sessionSecret: "test-session-secret-with-more-than-32-characters",
    sessionStore: new session.MemoryStore(),
    httpsEnabled: false,
    componentReader: reader,
    authService,
    userManagementService,
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
    expect(JSON.stringify(response.body)).not.toContain("mongodb");
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
  });

  it("rejects malformed component IDs safely", async () => {
    const { app, reader } = createTestApp();

    const response = await request(app).get("/api/components/not-an-id");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(reader.findPublicById).not.toHaveBeenCalled();
    expect(response.body).not.toHaveProperty("stack");
  });

  it("returns 404 for a valid ID with no matching component", async () => {
    const { app } = createTestApp();

    const response = await request(app).get(
      "/api/components/507f1f77bcf86cd799439011",
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
      isDatabaseConnected: () => true,
      logger,
      sessionSecret: "test-session-secret-with-more-than-32-characters",
      sessionStore: new session.MemoryStore(),
      httpsEnabled: false,
      componentReader: reader,
      authService: {
        authenticate: vi.fn(async () => null),
        findActiveUser: vi.fn(async () => null),
        changePassword: vi.fn(async () => false),
      },
      userManagementService: {
        listUsers: vi.fn(async () => []),
        createUser: vi.fn(async () => {
          throw new Error("Not implemented in this test");
        }),
        updateUser: vi.fn(async () => {
          throw new Error("Not implemented in this test");
        }),
        setUserActive: vi.fn(async () => {
          throw new Error("Not implemented in this test");
        }),
      },
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
  it("rejects invalid ports and MongoDB URLs", async () => {
    const { parseEnvironment } = await import("../config/env.js");

    expect(() =>
      parseEnvironment({
        PORT: "70000",
        MONGODB_URI: "mongodb-not-a-url",
        SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
