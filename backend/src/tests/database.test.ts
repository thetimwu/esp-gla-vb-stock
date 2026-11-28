import { randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
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
import { In } from "typeorm";
import { createApp } from "../app.js";
import { checkDatabaseConnection } from "../config/database.js";
import { AppDataSource } from "../config/dataSource.js";
import { parseEnvironment } from "../config/env.js";
import { closeSessionPool } from "../config/sessionStore.js";
import { createLogger } from "../config/logger.js";
import { AuditLog } from "../entities/AuditLog.js";
import { Component } from "../entities/Component.js";
import { StockAction, StockTransaction } from "../entities/StockTransaction.js";
import { User, UserRole } from "../entities/User.js";
import { componentReader } from "../services/componentService.js";

const logger = createLogger("silent");
const repository = AppDataSource.getRepository(Component);
const userRepository = AppDataSource.getRepository(User);
const transactionRepository = AppDataSource.getRepository(StockTransaction);
const auditRepository = AppDataSource.getRepository(AuditLog);
const fixtureComponentIds: string[] = [];
const fixtureUserIds: string[] = [];
let loginClientNumber = 0;

const app = createApp({
  checkDatabaseConnection,
  logger,
  componentReader,
});
app.set("trust proxy", 1);

beforeAll(async () => {
  const environment = parseEnvironment();
  const databaseName = environment.DB_NAME;
  const databaseHost = environment.DB_HOST;
  if (
    environment.NODE_ENV !== "test" ||
    !/(?:^|[_-])test(?:$|[_-])/i.test(databaseName) ||
    !["127.0.0.1", "localhost", "::1"].includes(databaseHost)
  ) {
    throw new Error(
      "PostgreSQL integration tests require NODE_ENV=test, a loopback DB_HOST, and a DB_NAME containing a standalone 'test' token",
    );
  }
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
});

beforeEach(async () => {
  const fixture = await repository.save(
    repository.create({
      name: `Database test component ${randomUUID()}`,
      description: "Test fixture",
      partNumber: "TEST-PART-0001",
      currentQuantity: 4,
      minimumStockLevel: 2,
      photoPath: null,
      attributes: { internal: "must not be public" },
      isActive: true,
    }),
  );
  fixtureComponentIds.push(fixture.id);
});

afterEach(async () => {
  const userIds = fixtureUserIds.splice(0);
  const componentIds = fixtureComponentIds.splice(0);
  if (userIds.length > 0) {
    await AppDataSource.query(
      `DELETE FROM "sessions" WHERE "sess"->>'userId' = ANY($1::text[])`,
      [userIds],
    );
    await auditRepository.delete({ userId: In(userIds) });
    await transactionRepository.delete({ userId: In(userIds) });
    await userRepository.delete(userIds);
  }
  if (componentIds.length > 0) {
    await transactionRepository.delete({ componentId: In(componentIds) });
    await auditRepository.delete({ entityId: In(componentIds) });
    await repository.delete(componentIds);
  }
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  await closeSessionPool();
});

async function createUser(role: UserRole, isActive = true): Promise<User> {
  const user = await userRepository.save({
    username: `integration-${randomUUID()}`,
    passwordHash: await hash("integration-passphrase", 10),
    role,
    isActive,
  });
  fixtureUserIds.push(user.id);
  return user;
}

async function login(user: User, password = "integration-passphrase") {
  const agent = request.agent(app);
  const csrfResponse = await agent.get("/api/auth/csrf-token");
  const response = await agent
    .post("/api/auth/login")
    .set("x-forwarded-for", `10.0.0.${++loginClientNumber}`)
    .set("x-csrf-token", csrfResponse.body.csrfToken)
    .send({ username: user.username, password });
  expect(response.status).toBe(200);
  return { agent, csrfToken: response.body.csrfToken as string };
}

describe("PostgreSQL-backed public API", () => {
  it("returns an empty component list when the PostgreSQL table is empty", async () => {
    await repository.delete(fixtureComponentIds.splice(0));

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

  it("serves aggregate stock statistics from PostgreSQL without a session", async () => {
    const response = await request(app).get("/api/statistics");

    expect(response.status).toBe(200);
    expect(response.body.statistics).toEqual({
      activeComponentCount: 1,
      totalStockQuantity: 4,
      lowStockComponentCount: 0,
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("lists active components from PostgreSQL with only public fields", async () => {
    const response = await request(app).get("/api/components");

    expect(response.status).toBe(200);
    expect(response.body.components).toContainEqual(
      expect.objectContaining({
        id: fixtureComponentIds[fixtureComponentIds.length - 1],
        displayName: expect.stringMatching(/^Database test component/),
        description: "Test fixture",
        partNumber: "TEST-PART-0001",
        currentQuantity: 4,
        minimumStockLevel: 2,
        photoUrl: null,
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("attributes");
    expect(JSON.stringify(response.body)).not.toContain("internal");
  });

  it("looks up a component and returns 404 for an unknown UUID", async () => {
    const id = fixtureComponentIds[fixtureComponentIds.length - 1];
    const found = await request(app).get(`/api/components/${id}`);
    const missing = await request(app).get(`/api/components/${randomUUID()}`);

    expect(found.status).toBe(200);
    expect(found.body.component.id).toBe(id);
    expect(found.body.component.partNumber).toBe("TEST-PART-0001");
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

  it("enforces component and user foreign keys on stock transactions", async () => {
    const user = await createUser(UserRole.ENGINEER);
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }
    const invalidComponent = transactionRepository.create({
      componentId: randomUUID(),
      userId: user.id,
      componentName: "Invalid component",
      username: user.username,
      actionType: StockAction.STOCK_IN,
      previousQuantity: 0,
      newQuantity: 1,
      quantityChange: 1,
      comment: null,
    });

    await expect(
      transactionRepository.save(invalidComponent),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: "23503" }),
    });

    const invalidUser = transactionRepository.create({
      componentId,
      userId: randomUUID(),
      componentName: "Database test component",
      username: "missing-user",
      actionType: StockAction.STOCK_IN,
      previousQuantity: 0,
      newQuantity: 1,
      quantityChange: 1,
      comment: null,
    });
    await expect(transactionRepository.save(invalidUser)).rejects.toMatchObject(
      {
        driverError: expect.objectContaining({ code: "23503" }),
      },
    );

    const invalidDirection = transactionRepository.create({
      componentId,
      userId: user.id,
      componentName: "Database test component",
      username: user.username,
      actionType: StockAction.STOCK_IN,
      previousQuantity: 0,
      newQuantity: 1,
      quantityChange: -1,
      comment: null,
    });
    await expect(
      transactionRepository.save(invalidDirection),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: "23514" }),
    });

    const excessiveComment = transactionRepository.create({
      componentId,
      userId: user.id,
      componentName: "Database test component",
      username: user.username,
      actionType: StockAction.STOCK_IN,
      previousQuantity: 0,
      newQuantity: 1,
      quantityChange: 1,
      comment: "x".repeat(501),
    });
    await expect(
      transactionRepository.save(excessiveComment),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: "23514" }),
    });
  });

  it("persists login sessions in PostgreSQL and invalidates them on logout", async () => {
    const user = await createUser(UserRole.ENGINEER);
    const { agent } = await login(user);
    const sessionRows = await AppDataSource.query(
      `SELECT "sid" FROM "sessions" WHERE "sess"->>'userId' = $1`,
      [user.id],
    );
    expect(sessionRows).toHaveLength(1);
    expect((await agent.get("/api/auth/session")).body.user).toMatchObject({
      id: user.id,
      role: UserRole.ENGINEER,
    });

    const csrfToken = (await agent.get("/api/auth/csrf-token")).body.csrfToken;
    const logout = await agent
      .post("/api/auth/logout")
      .set("x-csrf-token", csrfToken);
    expect(logout.status).toBe(204);
    expect((await agent.get("/api/auth/session")).body.user).toBeNull();
    expect((await agent.get("/api/transactions")).status).toBe(401);
  });

  it("enforces Engineer and Admin permissions against PostgreSQL", async () => {
    const engineer = await createUser(UserRole.ENGINEER);
    const { agent, csrfToken } = await login(engineer);

    expect((await agent.get("/api/transactions")).status).toBe(200);
    expect(
      (
        await agent
          .post(
            `/api/components/${fixtureComponentIds.at(-1)}/stock-transactions`,
          )
          .set("x-csrf-token", csrfToken)
          .send({ type: StockAction.STOCK_IN, quantity: 1 })
      ).status,
    ).toBe(201);
    expect((await agent.get("/api/admin/components")).status).toBe(403);
    expect((await agent.get("/api/admin/users")).status).toBe(403);
    expect(
      (
        await agent
          .post("/api/components")
          .set("x-csrf-token", csrfToken)
          .send({ name: "Engineer forbidden component" })
      ).status,
    ).toBe(403);

    const admin = await createUser(UserRole.ADMIN);
    const adminSession = await login(admin);
    expect(
      (
        await adminSession.agent
          .post(
            `/api/components/${fixtureComponentIds.at(-1)}/stock-transactions`,
          )
          .set("x-csrf-token", adminSession.csrfToken)
          .send({ type: StockAction.STOCK_IN, quantity: 1 })
      ).status,
    ).toBe(201);
    expect((await adminSession.agent.get("/api/admin/components")).status).toBe(
      200,
    );
    expect((await adminSession.agent.get("/api/admin/users")).status).toBe(200);
    expect((await adminSession.agent.get("/api/admin/audit-logs")).status).toBe(
      200,
    );
  });

  it("requires CSRF and protects admin component create/edit/archive operations", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const { agent, csrfToken } = await login(admin);

    const missingCsrf = await agent
      .post("/api/components")
      .send({ name: "Missing CSRF component" });
    expect(missingCsrf.status).toBe(403);

    const created = await agent
      .post("/api/components")
      .set("x-csrf-token", csrfToken)
      .send({
        name: `Admin component ${randomUUID()}`,
        description: "Admin-managed definition",
        minimumStockLevel: 3,
      });
    expect(created.status).toBe(201);
    const componentId = created.body.component.id as string;
    fixtureComponentIds.push(componentId);
    expect(created.body.component.currentQuantity).toBe(0);

    const quantityAttempt = await agent
      .patch(`/api/components/${componentId}`)
      .set("x-csrf-token", csrfToken)
      .send({ currentQuantity: 25 });
    expect(quantityAttempt.status).toBe(400);

    const updated = await agent
      .patch(`/api/components/${componentId}`)
      .set("x-csrf-token", csrfToken)
      .send({ minimumStockLevel: 5, description: "Updated details" });
    expect(updated.status).toBe(200);
    expect(updated.body.component.minimumStockLevel).toBe(5);

    const archived = await agent
      .patch(`/api/components/${componentId}`)
      .set("x-csrf-token", csrfToken)
      .send({ isActive: false });
    expect(archived.status).toBe(200);
    expect(
      (await request(app).get("/api/components")).body.components,
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: componentId })]),
    );
    expect(
      (await agent.get(`/api/admin/components/${componentId}`)).status,
    ).toBe(200);
  });

  it("hashes, changes roles, and deactivates users while revoking their sessions", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const { agent: adminAgent, csrfToken } = await login(admin);
    const password = "a secure integration password";
    const created = await adminAgent
      .post("/api/admin/users")
      .set("x-csrf-token", csrfToken)
      .send({
        username: `new-user-${randomUUID()}`,
        password,
        role: UserRole.ENGINEER,
      });
    expect(created.status).toBe(201);
    const createdId = created.body.user.id as string;
    fixtureUserIds.push(createdId);

    const createdEntity = await userRepository
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.id = :id", { id: createdId })
      .getOneOrFail();
    expect(createdEntity.passwordHash).not.toBe(password);
    expect(await compare(password, createdEntity.passwordHash)).toBe(true);

    const engineer = await login(createdEntity, password);
    expect((await engineer.agent.get("/api/admin/audit-logs")).status).toBe(
      403,
    );

    const promoted = await adminAgent
      .patch(`/api/admin/users/${createdId}`)
      .set("x-csrf-token", csrfToken)
      .send({ role: UserRole.ADMIN });
    expect(promoted.status).toBe(200);
    expect((await engineer.agent.get("/api/admin/audit-logs")).status).toBe(
      200,
    );

    const deactivated = await adminAgent
      .patch(`/api/admin/users/${createdId}`)
      .set("x-csrf-token", csrfToken)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect((await engineer.agent.get("/api/admin/audit-logs")).status).toBe(
      401,
    );
    expect(
      (await engineer.agent.get("/api/auth/session")).body.user,
    ).toBeNull();
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }
    const quantityBeforeRejectedWrite = (
      await repository.findOneByOrFail({ id: componentId })
    ).currentQuantity;
    expect(
      (
        await engineer.agent
          .post(`/api/components/${componentId}/stock-transactions`)
          .set("x-csrf-token", engineer.csrfToken)
          .send({ type: StockAction.STOCK_IN, quantity: 1 })
      ).status,
    ).toBe(401);
    expect(
      (await repository.findOneByOrFail({ id: componentId })).currentQuantity,
    ).toBe(quantityBeforeRejectedWrite);

    const reLogin = request.agent(app);
    const reLoginCsrf = (await reLogin.get("/api/auth/csrf-token")).body
      .csrfToken;
    const rejectedLogin = await reLogin
      .post("/api/auth/login")
      .set("x-csrf-token", reLoginCsrf)
      .send({
        username: createdEntity.username,
        password,
      });
    expect(rejectedLogin.status).toBe(401);
  });

  it("records stock-in, stock-out, and absolute adjustments with filtered history", async () => {
    const user = await createUser(UserRole.ENGINEER);
    const { agent, csrfToken } = await login(user);
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }
    const from = new Date(Date.now() - 1_000).toISOString();
    const operations = [
      { type: StockAction.STOCK_IN, quantity: 3 },
      { type: StockAction.STOCK_OUT, quantity: 2 },
      { type: StockAction.ADJUSTMENT, newQuantity: 8 },
    ];

    const results = [];
    for (const operation of operations) {
      const response = await agent
        .post(`/api/components/${componentId}/stock-transactions`)
        .set("x-csrf-token", csrfToken)
        .send(operation);
      expect(response.status).toBe(201);
      results.push(response.body.transaction);
    }

    expect(results.map((transaction) => transaction.newQuantity)).toEqual([
      7, 5, 8,
    ]);
    expect(results[0]).toMatchObject({
      componentId,
      componentName: expect.stringMatching(/^Database test component/),
      userId: user.id,
      username: user.username,
      actionType: StockAction.STOCK_IN,
      previousQuantity: 4,
      quantityChange: 3,
    });

    const to = new Date(Date.now() + 1_000).toISOString();
    const history = await agent.get(
      `/api/transactions?componentId=${componentId}&actionType=${StockAction.STOCK_OUT}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(history.status).toBe(200);
    expect(history.body.total).toBe(1);
    expect(history.body.transactions[0]).toMatchObject({
      componentName: results[0].componentName,
      username: user.username,
      actionType: StockAction.STOCK_OUT,
      previousQuantity: 7,
      newQuantity: 5,
      quantityChange: -2,
    });

    const component = await repository.findOneByOrFail({ id: componentId });
    expect(component.currentQuantity).toBe(8);
    expect(
      (await request(app).get("/api/statistics")).body.statistics,
    ).toMatchObject({
      totalStockQuantity: 8,
    });
  });

  it("rejects invalid quantities, excessive comments, and insufficient stock", async () => {
    const user = await createUser(UserRole.ENGINEER);
    const { agent, csrfToken } = await login(user);
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }
    const invalidOperations = [
      { type: StockAction.STOCK_IN, quantity: 0 },
      { type: StockAction.STOCK_IN, quantity: -1 },
      { type: StockAction.STOCK_IN, quantity: 1.5 },
      { type: StockAction.STOCK_IN, quantity: 2_147_483_647 },
      { type: StockAction.STOCK_OUT, quantity: 0 },
      { type: StockAction.STOCK_OUT, quantity: -1 },
      { type: StockAction.STOCK_OUT, quantity: 1.25 },
      { type: StockAction.ADJUSTMENT, newQuantity: -1 },
      { type: StockAction.ADJUSTMENT, newQuantity: 1.5 },
      { type: StockAction.STOCK_IN, quantity: 1, comment: "x".repeat(501) },
      { type: "UNKNOWN", quantity: 1 },
    ];

    for (const operation of invalidOperations) {
      const response = await agent
        .post(`/api/components/${componentId}/stock-transactions`)
        .set("x-csrf-token", csrfToken)
        .send(operation);
      expect(response.status).toBe(400);
    }

    const insufficient = await agent
      .post(`/api/components/${componentId}/stock-transactions`)
      .set("x-csrf-token", csrfToken)
      .send({ type: StockAction.STOCK_OUT, quantity: 5 });
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await transactionRepository.countBy({ componentId })).toBe(0);
    expect(
      (await repository.findOneByOrFail({ id: componentId })).currentQuantity,
    ).toBe(4);
  });

  it("rejects public and archived-component writes", async () => {
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }
    const anonymous = await request(app)
      .post(`/api/components/${componentId}/stock-transactions`)
      .send({ type: StockAction.STOCK_IN, quantity: 1 });
    expect(anonymous.status).toBe(401);

    const user = await createUser(UserRole.ENGINEER);
    const { agent, csrfToken } = await login(user);
    const missing = await agent
      .post(`/api/components/${randomUUID()}/stock-transactions`)
      .set("x-csrf-token", csrfToken)
      .send({ type: StockAction.STOCK_IN, quantity: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("COMPONENT_NOT_FOUND");

    const component = await repository.findOneByOrFail({ id: componentId });
    component.isActive = false;
    await repository.save(component);
    const archived = await agent
      .post(`/api/components/${componentId}/stock-transactions`)
      .set("x-csrf-token", csrfToken)
      .send({ type: StockAction.STOCK_IN, quantity: 1 });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe("COMPONENT_ARCHIVED");
    expect(await transactionRepository.countBy({ componentId })).toBe(0);
  });

  it("rolls back the quantity update if transaction insertion fails", async () => {
    const user = await createUser(UserRole.ENGINEER);
    const { agent, csrfToken } = await login(user);
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }
    try {
      await AppDataSource.query(`
        CREATE OR REPLACE FUNCTION fail_stock_transaction_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'injected transaction history failure';
        END;
        $$
      `);
      await AppDataSource.query(`
        DROP TRIGGER IF EXISTS fail_stock_transaction_insert ON stock_transactions
      `);
      await AppDataSource.query(`
        CREATE TRIGGER fail_stock_transaction_insert
        BEFORE INSERT ON stock_transactions
        FOR EACH ROW EXECUTE FUNCTION fail_stock_transaction_insert()
      `);
      const response = await agent
        .post(`/api/components/${componentId}/stock-transactions`)
        .set("x-csrf-token", csrfToken)
        .send({ type: StockAction.STOCK_IN, quantity: 2 });
      expect(response.status).toBe(500);
      expect(
        (await repository.findOneByOrFail({ id: componentId })).currentQuantity,
      ).toBe(4);
      expect(await transactionRepository.countBy({ componentId })).toBe(0);
    } finally {
      await AppDataSource.query(
        `DROP TRIGGER IF EXISTS fail_stock_transaction_insert ON stock_transactions`,
      );
      await AppDataSource.query(
        `DROP FUNCTION IF EXISTS fail_stock_transaction_insert()`,
      );
    }
  });

  it("serializes concurrent stock-outs without allowing negative stock", async () => {
    const user = await createUser(UserRole.ENGINEER);
    const { agent, csrfToken } = await login(user);
    const componentId = fixtureComponentIds.at(-1);
    if (!componentId) {
      throw new Error("Missing database test component fixture");
    }

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        agent
          .post(`/api/components/${componentId}/stock-transactions`)
          .set("x-csrf-token", csrfToken)
          .send({ type: StockAction.STOCK_OUT, quantity: 1 }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(4);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(4);
    expect(
      (await repository.findOneByOrFail({ id: componentId })).currentQuantity,
    ).toBe(0);
    expect(await transactionRepository.countBy({ componentId })).toBe(4);
  });
});
