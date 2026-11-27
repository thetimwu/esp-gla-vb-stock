import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors/ApiError.js";
import { UserRole } from "../entities/User.js";
import {
  requireActiveUser,
  requireAdmin,
  verifyCsrfToken,
} from "../middleware/authentication.js";
import { validateParams } from "../middleware/validate.js";
import { validateBody } from "../middleware/validateBody.js";
import type { AuthService } from "../services/authService.js";
import type { UserAdminService } from "../services/userAdminService.js";
import type { ComponentAdminService } from "../services/componentAdminService.js";
import {
  componentAdminIdParamsSchema,
  userIdParamsSchema,
} from "../validators/adminValidators.js";
import { sessionMiddleware } from "../config/sessionStore.js";
import type { RequestHandler } from "express";
import {
  historyReader,
  type HistoryReader,
} from "../services/historyService.js";

const userCreateSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z
      .string()
      .min(12)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
    role: z.enum(UserRole),
  })
  .strict();

const userUpdateSchema = z
  .object({
    username: z.string().trim().min(1).max(100).optional(),
    password: z
      .string()
      .min(12)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72)
      .optional(),
    role: z.enum(UserRole).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field",
  );

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export function createAdminRouter(
  auth: AuthService,
  userManager: UserAdminService,
  componentManager: ComponentAdminService,
  sessionHandler: RequestHandler = sessionMiddleware,
  history: HistoryReader = historyReader,
): Router {
  const router = Router();
  router.use(sessionHandler, requireActiveUser(auth), requireAdmin);

  router.get("/components", async (_request, response) => {
    response.status(200).json({ components: await componentManager.list() });
  });

  router.get(
    "/components/:componentId",
    validateParams(componentAdminIdParamsSchema),
    async (request, response) => {
      const { componentId } = componentAdminIdParamsSchema.parse(
        request.params,
      );
      const component = await componentManager.findById(componentId);
      if (!component) {
        throw new ApiError(404, "COMPONENT_NOT_FOUND", "Component not found");
      }
      response.status(200).json({ component });
    },
  );

  router.get("/users", async (_request, response) => {
    response.status(200).json({ users: await userManager.list() });
  });

  router.post(
    "/users",
    verifyCsrfToken,
    validateBody(userCreateSchema),
    async (request, response) => {
      const { username, password, role } = request.body;
      const user = await userManager.create(
        username,
        password,
        role,
        request.user!.id,
      );
      response.status(201).json({ user });
    },
  );

  router.patch(
    "/users/:userId",
    verifyCsrfToken,
    validateParams(userIdParamsSchema),
    validateBody(userUpdateSchema),
    async (request, response) => {
      const { userId } = userIdParamsSchema.parse(request.params);
      const user = await userManager.update(
        userId,
        request.body,
        request.user!.id,
      );
      response.status(200).json({ user });
    },
  );

  router.get("/audit-logs", async (request, response) => {
    const pagination = paginationSchema.safeParse(request.query);
    if (!pagination.success) throw pagination.error;
    const { limit, offset } = pagination.data;
    const page = await history.listAuditLogs(limit, offset);
    response
      .status(200)
      .json({ auditLogs: page.records, total: page.total, limit, offset });
  });

  return router;
}

export function createTransactionHistoryRouter(
  auth: AuthService,
  sessionHandler: RequestHandler = sessionMiddleware,
  history: HistoryReader = historyReader,
): Router {
  const router = Router();
  router.use(sessionHandler, requireActiveUser(auth));
  router.get("/", async (request, response) => {
    const pagination = paginationSchema.safeParse(request.query);
    if (!pagination.success) throw pagination.error;
    const { limit, offset } = pagination.data;
    const page = await history.listTransactions(limit, offset);
    response.status(200).json({
      transactions: page.records,
      total: page.total,
      limit,
      offset,
    });
  });
  return router;
}
