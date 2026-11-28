import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import session from "express-session";
import { createApp } from "../app.js";
import { createLogger } from "../config/logger.js";
import { UserRole } from "../entities/User.js";
import type { AuthService } from "../services/authService.js";
import type { ComponentAdminService } from "../services/componentAdminService.js";
import type {
  ComponentReader,
  PublicComponent,
} from "../services/componentService.js";
import type {
  AdminUser,
  UserAdminService,
} from "../services/userAdminService.js";
import type { HistoryReader } from "../services/historyService.js";

const logger: Logger = createLogger("silent");
const engineer = {
  id: "engineer-id",
  username: "engineer",
  role: UserRole.ENGINEER,
};
const admin = {
  id: "admin-id",
  username: "admin",
  role: UserRole.ADMIN,
};

const component: PublicComponent = {
  id: "8a03ff64-6c8a-4b79-92e1-7104747064fd",
  displayName: "Example component",
  description: "A non-sensitive component description",
  partNumber: "EXAMPLE-001",
  currentQuantity: 4,
  minimumStockLevel: 2,
  photoUrl: null,
};

function createTestApp(
  overrides: {
    connected?: boolean;
    components?: PublicComponent[];
    detail?: PublicComponent | null;
    auth?: AuthService;
    componentAdmin?: ComponentAdminService;
    userAdmin?: UserAdminService;
    historyReader?: HistoryReader;
  } = {},
) {
  const components = overrides.components ?? [];
  const reader: ComponentReader = {
    listPublic: vi.fn(async () => components),
    findPublicById: vi.fn(async () => overrides.detail ?? null),
    getPublicStatistics: vi.fn(async () => ({
      activeComponentCount: components.length,
      totalStockQuantity: components.reduce(
        (total, item) => total + item.currentQuantity,
        0,
      ),
      lowStockComponentCount: components.filter(
        (item) => item.currentQuantity < item.minimumStockLevel,
      ).length,
    })),
  };
  const defaultUsers: AdminUser[] = [];
  const auth: AuthService = overrides.auth ?? {
    authenticate: vi.fn(async (username, password) => {
      if (password !== "correct horse battery") return null;
      return username === "admin" ? admin : engineer;
    }),
    findActiveById: vi.fn(async (id) => {
      if (id === engineer.id) return engineer;
      if (id === admin.id) return admin;
      return null;
    }),
  };
  const componentAdmin: ComponentAdminService = overrides.componentAdmin ?? {
    list: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    create: vi.fn(async (changes) => ({
      id: "component-created",
      name: changes.name ?? "new component",
      description: changes.description ?? "",
      partNumber: changes.partNumber ?? null,
      currentQuantity: 0,
      minimumStockLevel: changes.minimumStockLevel ?? 0,
      photoPath: changes.photoPath ?? null,
      attributes: changes.attributes ?? {},
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: vi.fn(async (id, changes) => ({
      id,
      name: changes.name ?? "updated component",
      description: changes.description ?? "",
      partNumber: changes.partNumber ?? null,
      currentQuantity: 0,
      minimumStockLevel: changes.minimumStockLevel ?? 0,
      photoPath: changes.photoPath ?? null,
      attributes: changes.attributes ?? {},
      isActive: changes.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  };
  const userAdmin: UserAdminService = overrides.userAdmin ?? {
    list: vi.fn(async () => defaultUsers),
    create: vi.fn(async (username, _password, role) => ({
      id: "created-user",
      username,
      role,
      isActive: true,
      passwordChangeRequired: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: vi.fn(async (id, changes) => ({
      id,
      username: changes.username ?? "updated-user",
      role: changes.role ?? UserRole.ENGINEER,
      isActive: changes.isActive ?? true,
      passwordChangeRequired: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  };
  const historyReader: HistoryReader = overrides.historyReader ?? {
    listTransactions: vi.fn(async () => ({ records: [], total: 0 })),
    listAuditLogs: vi.fn(async () => ({ records: [], total: 0 })),
  };
  const app = createApp({
    checkDatabaseConnection: async () => {
      if (overrides.connected === false) {
        throw new Error("database unavailable");
      }
    },
    logger,
    componentReader: reader,
    auth,
    componentAdmin,
    userAdmin,
    historyReader,
    sessionHandler: session({
      secret: "unit-test-session-secret-with-more-than-32-characters",
      resave: false,
      saveUninitialized: false,
      cookie: { sameSite: "strict" },
    }),
  });
  return { app, reader, auth, componentAdmin, userAdmin };
}

async function login(
  app: ReturnType<typeof createTestApp>["app"],
  username: "engineer" | "admin",
) {
  const agent = request.agent(app);
  const tokenResponse = await agent.get("/api/auth/csrf-token");
  const response = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", tokenResponse.body.csrfToken)
    .send({ username, password: "correct horse battery" });
  return { agent, response };
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

  it("serves public stock statistics without creating a session", async () => {
    const lowStockComponent = {
      ...component,
      id: "7b03ff64-6c8a-4b79-92e1-7104747064fd",
      currentQuantity: 1,
    };
    const { app } = createTestApp({
      components: [component, lowStockComponent],
    });

    const response = await request(app).get("/api/statistics");

    expect(response.status).toBe(200);
    expect(response.body.statistics).toEqual({
      activeComponentCount: 2,
      totalStockQuantity: 5,
      lowStockComponentCount: 1,
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("returns only public component details without authentication", async () => {
    const { app } = createTestApp({ detail: component });

    const response = await request(app).get(`/api/components/${component.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ component });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  describe("authentication and authorization", () => {
    it("allows login and logout with CSRF tokens and returns no credential data", async () => {
      const { app } = createTestApp();
      const { agent, response } = await login(app, "engineer");

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual(engineer);
      expect(response.body).not.toHaveProperty("passwordHash");
      const csrfToken = response.body.csrfToken as string;
      const sessionResponse = await agent.get("/api/auth/session");
      expect(sessionResponse.body.user).toEqual(engineer);

      const logout = await agent
        .post("/api/auth/logout")
        .set("x-csrf-token", csrfToken);
      expect(logout.status).toBe(204);
      expect((await agent.get("/api/auth/session")).body.user).toBeNull();
    });

    it("rejects anonymous transaction history and admin data requests", async () => {
      const { app } = createTestApp();

      const [transactions, users, auditLogs] = await Promise.all([
        request(app).get("/api/transactions"),
        request(app).get("/api/admin/users"),
        request(app).get("/api/admin/audit-logs"),
      ]);

      expect(transactions.status).toBe(401);
      expect(users.status).toBe(401);
      expect(auditLogs.status).toBe(401);
    });

    it("does not expose a stock-mutation endpoint in this milestone", async () => {
      const { app } = createTestApp();

      const response = await request(app)
        .post(`/api/components/${component.id}/stock-in`)
        .send({ quantity: 1 });

      expect(response.status).toBe(404);
    });

    it("denies Engineers component and user administration", async () => {
      const { app } = createTestApp();
      const { agent, response } = await login(app, "engineer");
      const csrfToken = response.body.csrfToken as string;

      const [component, componentList, users] = await Promise.all([
        agent
          .post("/api/components")
          .set("x-csrf-token", csrfToken)
          .send({ name: "Restricted component" }),
        agent.get("/api/admin/components"),
        agent.post("/api/admin/users").set("x-csrf-token", csrfToken).send({
          username: "new-engineer",
          password: "a secure password",
          role: UserRole.ENGINEER,
        }),
      ]);

      expect(component.status).toBe(403);
      expect(componentList.status).toBe(403);
      expect(users.status).toBe(403);
    });

    it("allows Engineers to read transactions but not audit logs", async () => {
      const { app } = createTestApp();
      const { agent } = await login(app, "engineer");

      const [transactions, auditLogs] = await Promise.all([
        agent.get("/api/transactions"),
        agent.get("/api/admin/audit-logs"),
      ]);

      expect(transactions.status).toBe(200);
      expect(transactions.body.transactions).toEqual([]);
      expect(auditLogs.status).toBe(403);
    });

    it("allows Admins to create components and user accounts", async () => {
      const { app, componentAdmin, userAdmin } = createTestApp();
      const { agent, response } = await login(app, "admin");
      const csrfToken = response.body.csrfToken as string;

      const [component, user] = await Promise.all([
        agent
          .post("/api/components")
          .set("x-csrf-token", csrfToken)
          .send({ name: "Managed component" }),
        agent.post("/api/admin/users").set("x-csrf-token", csrfToken).send({
          username: "new-engineer",
          password: "a secure password",
          role: UserRole.ENGINEER,
        }),
      ]);

      expect(component.status).toBe(201);
      expect(user.status).toBe(201);
      expect(user.body.user).not.toHaveProperty("passwordHash");
      expect(componentAdmin.create).toHaveBeenCalledOnce();
      expect(userAdmin.create).toHaveBeenCalledOnce();
    });

    it("allows Admins to list all component definitions", async () => {
      const { app } = createTestApp();
      const { agent } = await login(app, "admin");

      const response = await agent.get("/api/admin/components");

      expect(response.status).toBe(200);
      expect(response.body.components).toEqual([]);
    });

    it("allows Admins to edit components and assign user roles", async () => {
      const { app, componentAdmin, userAdmin } = createTestApp();
      const { agent, response } = await login(app, "admin");

      const [componentResponse, userResponse] = await Promise.all([
        agent
          .patch(`/api/components/${component.id}`)
          .set("x-csrf-token", response.body.csrfToken)
          .send({ minimumStockLevel: 5 }),
        agent
          .patch("/api/admin/users/8a03ff64-6c8a-4b79-92e1-7104747064fd")
          .set("x-csrf-token", response.body.csrfToken)
          .send({ role: UserRole.ADMIN }),
      ]);

      expect(componentResponse.status).toBe(200);
      expect(userResponse.status).toBe(200);
      expect(componentAdmin.update).toHaveBeenCalledOnce();
      expect(userAdmin.update).toHaveBeenCalledOnce();
    });

    it("does not let component-management APIs alter current quantity", async () => {
      const { app, componentAdmin } = createTestApp();
      const { agent, response } = await login(app, "admin");

      const update = await agent
        .patch(`/api/components/${component.id}`)
        .set("x-csrf-token", response.body.csrfToken)
        .send({ currentQuantity: 100 });

      expect(update.status).toBe(400);
      expect(componentAdmin.update).not.toHaveBeenCalled();
    });

    it("allows Admins to view transaction history and audit logs", async () => {
      const { app } = createTestApp();
      const { agent } = await login(app, "admin");

      const [transactions, auditLogs] = await Promise.all([
        agent.get("/api/transactions"),
        agent.get("/api/admin/audit-logs"),
      ]);

      expect(transactions.status).toBe(200);
      expect(auditLogs.status).toBe(200);
    });

    it("invalidates an existing session after the account is deactivated", async () => {
      let active = true;
      const auth: AuthService = {
        authenticate: vi.fn(async () => engineer),
        findActiveById: vi.fn(async (id) =>
          active && id === engineer.id ? engineer : null,
        ),
      };
      const { app } = createTestApp({ auth });
      const { agent, response } = await login(app, "engineer");
      expect(response.status).toBe(200);

      active = false;
      const protectedResponse = await agent.get("/api/admin/users");
      expect(protectedResponse.status).toBe(401);
    });

    it("rejects an invalid CSRF token on login", async () => {
      const { app } = createTestApp();
      const agent = request.agent(app);
      await agent.get("/api/auth/csrf-token");

      const response = await agent
        .post("/api/auth/login")
        .set("x-csrf-token", "invalid")
        .send({ username: "engineer", password: "correct horse battery" });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
    });

    it("rate-limits repeated login attempts", async () => {
      const { app } = createTestApp();
      const agent = request.agent(app);
      const token = (await agent.get("/api/auth/csrf-token")).body.csrfToken;
      let response;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        response = await agent
          .post("/api/auth/login")
          .set("x-csrf-token", token)
          .send({ username: "engineer", password: "wrong password" });
      }

      expect(response?.status).toBe(429);
      expect(response?.body.error.code).toBe("LOGIN_RATE_LIMITED");
    });
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
      getPublicStatistics: vi.fn().mockResolvedValue({
        activeComponentCount: 0,
        totalStockQuantity: 0,
        lowStockComponentCount: 0,
      }),
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
