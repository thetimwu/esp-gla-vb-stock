import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createApp } from "../app.js";
import { ApiError } from "../errors/ApiError.js";
import { createLogger } from "../config/logger.js";
import {
  SESSION_MAX_AGE_MS,
  SESSION_TTL_SECONDS,
} from "../middleware/session.js";
import type {
  AuthService,
  AuthenticatedUser,
} from "../services/authService.js";
import {
  assertActiveAdminCanBeRemoved,
  type SafeUser,
  type UserManagementService,
} from "../services/userManagementService.js";
import { hashPassword, verifyPassword } from "../services/passwordService.js";
import type {
  CreateUserBody,
  UpdateUserBody,
} from "../validators/authValidators.js";

const logger: Logger = createLogger("silent");
const ADMIN_ID = "507f1f77bcf86cd799439011";
const ENGINEER_ID = "507f1f77bcf86cd799439012";
const TARGET_ID = "507f1f77bcf86cd799439013";

const admin: AuthenticatedUser = {
  id: ADMIN_ID,
  username: "admin",
  role: "Admin",
  passwordChangeRequired: false,
};
const engineer: AuthenticatedUser = {
  id: ENGINEER_ID,
  username: "engineer",
  role: "Engineer",
  passwordChangeRequired: false,
};
const safeUser: SafeUser = {
  id: TARGET_ID,
  username: "new.engineer",
  role: "Engineer",
  isActive: true,
  passwordChangeRequired: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function createTestApp(
  overrides: {
    authenticate?: AuthService["authenticate"];
    findActiveUser?: AuthService["findActiveUser"];
    changePassword?: AuthService["changePassword"];
    listUsers?: UserManagementService["listUsers"];
    createUser?: UserManagementService["createUser"];
    updateUser?: UserManagementService["updateUser"];
    setUserActive?: UserManagementService["setUserActive"];
    loginRateLimit?: number;
    httpsEnabled?: boolean;
  } = {},
) {
  const usersById = new Map([
    [ADMIN_ID, admin],
    [ENGINEER_ID, engineer],
  ]);
  const authService: AuthService = {
    authenticate:
      overrides.authenticate ??
      vi.fn(async (username) => (username === "engineer" ? engineer : admin)),
    findActiveUser:
      overrides.findActiveUser ??
      vi.fn(async (userId) => usersById.get(userId) ?? null),
    changePassword: overrides.changePassword ?? vi.fn(async () => true),
  };
  const userService: UserManagementService = {
    listUsers: overrides.listUsers ?? vi.fn(async () => [safeUser]),
    createUser:
      overrides.createUser ??
      vi.fn(async (actorId: string, input: CreateUserBody) => {
        expect(actorId).toBe(ADMIN_ID);
        return { ...safeUser, username: input.username };
      }),
    updateUser:
      overrides.updateUser ??
      vi.fn(async (actorId: string, userId: string, input: UpdateUserBody) => {
        expect(actorId).toBe(ADMIN_ID);
        expect(userId).toBe(TARGET_ID);
        return {
          ...safeUser,
          ...(input.username === undefined ? {} : { username: input.username }),
          ...(input.role === undefined ? {} : { role: input.role }),
        };
      }),
    setUserActive:
      overrides.setUserActive ??
      vi.fn(async (actorId: string, userId: string, isActive: boolean) => {
        expect(actorId).toBe(ADMIN_ID);
        expect(userId).toBe(TARGET_ID);
        return {
          ...safeUser,
          isActive,
          passwordChangeRequired: false,
        };
      }),
  };

  const app = createApp({
    isDatabaseConnected: () => true,
    logger,
    sessionSecret: "test-session-secret-with-more-than-32-characters",
    sessionStore: new session.MemoryStore(),
    httpsEnabled: overrides.httpsEnabled ?? false,
    authService,
    userManagementService: userService,
    ...(overrides.loginRateLimit === undefined
      ? {}
      : { loginRateLimit: overrides.loginRateLimit }),
    componentReader: {
      listPublic: vi.fn(async () => []),
      findPublicById: vi.fn(async () => null),
    },
  });
  return { app, authService, userService };
}

async function getCsrfToken(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/auth/csrf-token");
  expect(response.status).toBe(200);
  return response.body.csrfToken as string;
}

function getCookies(response: request.Response): string[] {
  const cookies = response.headers["set-cookie"];
  return Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
}

async function login(
  agent: ReturnType<typeof request.agent>,
  username = "admin",
) {
  const csrfToken = await getCsrfToken(agent);
  return agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ username, password: "A-long-test-password-123" });
}

describe("authentication and session security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates, regenerates the session, persists it, and returns no secrets", async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);

    const csrfResponse = await agent.get("/api/auth/csrf-token");
    const initialCookie = getCookies(csrfResponse)[0];
    const loginResponse = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", csrfResponse.body.csrfToken as string)
      .send({ username: "admin", password: "A-long-test-password-123" });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user).toEqual({
      id: ADMIN_ID,
      username: "admin",
      role: "Admin",
      passwordChangeRequired: false,
    });
    expect(JSON.stringify(loginResponse.body)).not.toContain("passwordHash");
    expect(JSON.stringify(loginResponse.body)).not.toContain(
      "A-long-test-password-123",
    );
    const loginCookie = getCookies(loginResponse)[0];
    expect(initialCookie?.split(";")[0]).not.toBe(loginCookie?.split(";")[0]);
    expect(loginCookie).toContain("HttpOnly");
    expect(loginCookie).toContain("SameSite=Lax");
    expect(loginCookie).not.toContain("Secure");
    expect(loginCookie).toContain("Expires=");
    const expiresValue = loginCookie?.match(/Expires=([^;]+)/)?.[1];
    expect(expiresValue).toBeDefined();
    const expiresInMs = new Date(expiresValue ?? "").getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(SESSION_MAX_AGE_MS - 5_000);
    expect(expiresInMs).toBeLessThanOrEqual(SESSION_MAX_AGE_MS);

    const meResponse = await agent.get("/api/auth/me");
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.username).toBe("admin");
    expect(JSON.stringify(meResponse.body)).not.toContain("passwordHash");
  });

  it("uses the same safe error for unknown usernames and incorrect passwords", async () => {
    const { app, authService } = createTestApp({
      authenticate: vi.fn(async () => null),
    });
    const agent = request.agent(app);
    const first = await login(agent, "missing");
    const second = await login(agent, "wrong-password");

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(first.body).toEqual(second.body);
    expect(first.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    });
    expect(authService.authenticate).toHaveBeenCalledTimes(2);
  });

  it("rejects deactivated users with the generic login error", async () => {
    const { app } = createTestApp({
      authenticate: vi.fn(async () => null),
    });
    const response = await login(request.agent(app), "inactive");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("revokes sessions when the account becomes inactive", async () => {
    const { app } = createTestApp({
      findActiveUser: vi.fn(async () => null),
    });
    const agent = request.agent(app);
    const loginResponse = await login(agent);
    expect(loginResponse.status).toBe(200);
    const meResponse = await agent.get("/api/auth/me");
    expect(meResponse.status).toBe(401);
    expect(meResponse.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(getCookies(meResponse)[0]).toContain("Expires=");
  });

  it("rejects state-changing requests without a valid CSRF token", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "A-long-test-password-123" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
  });

  it("hashes passwords with Argon2id and verifies without storing plaintext", async () => {
    const password = "A-long-test-password-123";
    const passwordHash = await hashPassword(password);
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(
      verifyPassword("an incorrect password", passwordHash),
    ).resolves.toBe(false);
  });

  it("invalidates the session on logout and rejects subsequent access", async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);
    const loginResponse = await login(agent);
    const logoutResponse = await agent
      .post("/api/auth/logout")
      .set("x-csrf-token", loginResponse.body.csrfToken as string);

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers["set-cookie"]?.[0]).toContain("gate.sid=");
    expect(logoutResponse.headers["set-cookie"]?.[0]).toContain("Expires=");
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("sets the eight-hour lifetime and supports authenticated password changes", async () => {
    const { app, authService } = createTestApp();
    const agent = request.agent(app);
    const loginResponse = await login(agent);
    const response = await agent
      .post("/api/auth/password-change")
      .set("x-csrf-token", loginResponse.body.csrfToken as string)
      .send({
        currentPassword: "A-long-test-password-123",
        newPassword: "A-new-long-password-456",
      });

    expect(SESSION_MAX_AGE_MS).toBe(8 * 60 * 60 * 1000);
    expect(SESSION_TTL_SECONDS).toBe(8 * 60 * 60);
    expect(response.status).toBe(200);
    expect(response.body.user.passwordChangeRequired).toBe(false);
    expect(authService.changePassword).toHaveBeenCalledWith(
      ADMIN_ID,
      "A-long-test-password-123",
      "A-new-long-password-456",
    );
  });

  it("requires newly created users to change their initial password", async () => {
    const forcedUser: AuthenticatedUser = {
      ...admin,
      passwordChangeRequired: true,
    };
    const { app } = createTestApp({
      authenticate: vi.fn(async () => forcedUser),
      findActiveUser: vi.fn(async () => forcedUser),
    });
    const agent = request.agent(app);
    const loginResponse = await login(agent);
    const csrfToken = loginResponse.body.csrfToken as string;
    expect(loginResponse.body.user.passwordChangeRequired).toBe(true);

    const blocked = await agent.get("/api/users");
    const changed = await agent
      .post("/api/auth/password-change")
      .set("x-csrf-token", csrfToken)
      .send({
        currentPassword: "A-long-test-password-123",
        newPassword: "A-new-long-password-456",
      });

    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(changed.status).toBe(200);
    expect(changed.body.user.passwordChangeRequired).toBe(false);
  });

  it("rate-limits repeated login attempts", async () => {
    const { app } = createTestApp({
      authenticate: vi.fn(async () => null),
      loginRateLimit: 2,
    });
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const body = { username: "missing", password: "A-long-test-password-123" };
    await agent
      .post("/api/auth/login")
      .set("x-csrf-token", csrfToken)
      .send(body);
    await agent
      .post("/api/auth/login")
      .set("x-csrf-token", csrfToken)
      .send(body);
    const limited = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", csrfToken)
      .send(body);

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("LOGIN_RATE_LIMITED");
  });

  it("marks the session cookie Secure when HTTPS is enabled", async () => {
    const { app } = createTestApp({ httpsEnabled: true });
    const csrfResponse = await request(app)
      .get("/api/auth/csrf-token")
      .set("x-forwarded-proto", "https");
    const sessionCookie = getCookies(csrfResponse)[0]?.split(";")[0];
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .set("x-forwarded-proto", "https")
      .set("cookie", sessionCookie ?? "")
      .set("x-csrf-token", csrfResponse.body.csrfToken as string)
      .send({ username: "admin", password: "A-long-test-password-123" });
    expect(loginResponse.status).toBe(200);
    expect(getCookies(loginResponse)[0]).toContain("Secure");
  });
});

describe("user management authorization and validation", () => {
  it("rejects anonymous access and denies Engineer access", async () => {
    const { app } = createTestApp();
    expect((await request(app).get("/api/users")).status).toBe(401);

    const engineerAgent = request.agent(app);
    const engineerLogin = await login(engineerAgent, "engineer");
    const response = await engineerAgent
      .get("/api/users")
      .set("x-csrf-token", engineerLogin.body.csrfToken as string);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows Admin user management and omits credentials from responses", async () => {
    const { app, userService } = createTestApp();
    const agent = request.agent(app);
    const loginResponse = await login(agent);
    const csrfToken = loginResponse.body.csrfToken as string;

    const list = await agent.get("/api/users");
    const created = await agent
      .post("/api/users")
      .set("x-csrf-token", csrfToken)
      .send({
        username: "New.Engineer",
        role: "Engineer",
        initialPassword: "A-long-initial-password-123",
      });
    const updated = await agent
      .patch(`/api/users/${TARGET_ID}`)
      .set("x-csrf-token", csrfToken)
      .send({ role: "Admin" });
    const deactivated = await agent
      .post(`/api/users/${TARGET_ID}/deactivate`)
      .set("x-csrf-token", csrfToken)
      .send({});
    const reactivated = await agent
      .post(`/api/users/${TARGET_ID}/reactivate`)
      .set("x-csrf-token", csrfToken)
      .send({});

    expect(list.status).toBe(200);
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deactivated.body.user.isActive).toBe(false);
    expect(reactivated.body.user.isActive).toBe(true);
    for (const response of [list, created, updated, deactivated, reactivated]) {
      expect(JSON.stringify(response.body)).not.toContain("passwordHash");
      expect(JSON.stringify(response.body)).not.toContain(
        "A-long-initial-password-123",
      );
    }
    expect(created.body.user.passwordChangeRequired).toBe(true);
    expect(userService.createUser).toHaveBeenCalledWith(
      ADMIN_ID,
      expect.objectContaining({ username: "new.engineer" }),
    );
  });

  it("validates all user API payloads and preserves duplicate-name errors", async () => {
    const { app, userService } = createTestApp({
      createUser: vi.fn(async () => {
        throw new ApiError(409, "USERNAME_TAKEN", "Username is already in use");
      }),
    });
    const agent = request.agent(app);
    const loginResponse = await login(agent);
    const csrfToken = loginResponse.body.csrfToken as string;
    const invalidQuery = await agent.get("/api/users?unexpected=true");
    const invalidActionBody = await agent
      .post(`/api/users/${TARGET_ID}/deactivate`)
      .set("x-csrf-token", csrfToken)
      .send({ isActive: false });

    const invalid = await agent
      .post("/api/users")
      .set("x-csrf-token", csrfToken)
      .send({
        username: "x",
        role: "Engineer",
        initialPassword: "short",
      });
    expect(invalid.status).toBe(400);
    expect(userService.createUser).not.toHaveBeenCalled();
    expect(invalidQuery.status).toBe(400);
    expect(invalidActionBody.status).toBe(400);
    expect(userService.setUserActive).not.toHaveBeenCalled();
    vi.mocked(userService.createUser).mockClear();
    const duplicate = await agent
      .post("/api/users")
      .set("x-csrf-token", csrfToken)
      .send({
        username: "already.used",
        role: "Engineer",
        initialPassword: "A-long-initial-password-123",
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("USERNAME_TAKEN");
  });

  it("protects the last active Admin from deactivation or demotion", () => {
    expect(() => assertActiveAdminCanBeRemoved(1)).toThrowError(
      expect.objectContaining({ code: "LAST_ACTIVE_ADMIN", status: 409 }),
    );
    expect(() => assertActiveAdminCanBeRemoved(2)).not.toThrow();
  });
});

describe("public component access", () => {
  it("keeps component GETs public and does not create an authenticated session", async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);
    expect((await agent.get("/api/components")).status).toBe(200);
    expect((await agent.get("/api/components/")).status).toBe(200);
    expect((await agent.get("/api/health")).status).toBe(200);
    expect(
      (await agent.get("/api/components")).headers["set-cookie"],
    ).toBeUndefined();
  });
});
