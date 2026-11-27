import { hash } from "bcryptjs";
import { AppDataSource } from "../config/dataSource.js";
import { ApiError } from "../errors/ApiError.js";
import { AuditLog } from "../entities/AuditLog.js";
import { User, type UserRole } from "../entities/User.js";
import type { EntityManager } from "typeorm";

export interface UserChanges {
  username?: string;
  role?: UserRole;
  isActive?: boolean;
  password?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  passwordChangeRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toAdminUser(user: User): AdminUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    passwordChangeRequired: user.passwordChangeRequired,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "driverError" in error &&
    typeof error.driverError === "object" &&
    error.driverError !== null &&
    "code" in error.driverError &&
    error.driverError.code === "23505"
  );
}

async function saveAudit(
  manager: EntityManager,
  actorId: string,
  user: User,
  action: string,
  changedFields: string[],
): Promise<void> {
  await manager.getRepository(AuditLog).save({
    userId: actorId,
    action,
    entityType: "user",
    entityId: user.id,
    details: { changedFields },
  });
}

export interface UserAdminService {
  list(): Promise<AdminUser[]>;
  create(
    username: string,
    password: string,
    role: UserRole,
    actorId: string,
  ): Promise<AdminUser>;
  update(id: string, changes: UserChanges, actorId: string): Promise<AdminUser>;
}

export const userAdminService: UserAdminService = {
  async list() {
    const users = await AppDataSource.getRepository(User).find({
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        passwordChangeRequired: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { username: "ASC" },
    });
    return users.map(toAdminUser);
  },

  async create(username, password, role, actorId) {
    try {
      return await AppDataSource.transaction(async (manager) => {
        const user = await manager.getRepository(User).save({
          username,
          passwordHash: await hash(password, 12),
          role,
          isActive: true,
          passwordChangeRequired: false,
        });
        await saveAudit(manager, actorId, user, "USER_CREATED", [
          "username",
          "role",
        ]);
        return toAdminUser(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "USERNAME_CONFLICT", "Username already exists");
      }
      throw error;
    }
  },

  async update(id, changes, actorId) {
    try {
      return await AppDataSource.transaction(async (manager) => {
        const repository = manager.getRepository(User);
        const user = await repository.findOne({ where: { id } });
        if (!user) {
          throw new ApiError(404, "USER_NOT_FOUND", "User not found");
        }
        if (changes.username !== undefined) user.username = changes.username;
        if (changes.role !== undefined) user.role = changes.role;
        if (changes.isActive !== undefined) user.isActive = changes.isActive;
        if (changes.password !== undefined) {
          user.passwordHash = await hash(changes.password, 12);
        }
        const saved = await repository.save(user);
        await saveAudit(manager, actorId, saved, "USER_UPDATED", [
          ...Object.keys(changes).filter((key) => key !== "password"),
          ...(changes.password === undefined ? [] : ["passwordChanged"]),
        ]);
        return toAdminUser(saved);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "USERNAME_CONFLICT", "Username already exists");
      }
      throw error;
    }
  },
};
