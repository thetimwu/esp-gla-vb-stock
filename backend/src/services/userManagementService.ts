import { Types, type ClientSession } from "mongoose";
import { ApiError } from "../errors/ApiError.js";
import { AuditLogModel } from "../models/AuditLog.js";
import { SystemStateModel } from "../models/SystemState.js";
import { UserModel, type UserRole } from "../models/User.js";
import type {
  CreateUserBody,
  UpdateUserBody,
} from "../validators/authValidators.js";
import { hashPassword } from "./passwordService.js";

export interface SafeUser {
  id: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  passwordChangeRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserManagementService {
  listUsers(): Promise<SafeUser[]>;
  createUser(actorId: string, input: CreateUserBody): Promise<SafeUser>;
  updateUser(
    actorId: string,
    userId: string,
    input: UpdateUserBody,
  ): Promise<SafeUser>;
  setUserActive(
    actorId: string,
    userId: string,
    isActive: boolean,
  ): Promise<SafeUser>;
}

function toSafeUser(user: {
  _id: Types.ObjectId;
  username: string;
  role: UserRole;
  isActive: boolean;
  passwordChangeRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SafeUser {
  return {
    id: user._id.toString(),
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    passwordChangeRequired: user.passwordChangeRequired,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function getActorId(actorId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(actorId)) {
    throw new ApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication required",
    );
  }
  return new Types.ObjectId(actorId);
}

async function runTransaction<T>(
  action: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await UserModel.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await action(session);
    });
    if (result === undefined) {
      throw new Error("User-management transaction produced no result");
    }
    return result;
  } finally {
    await session.endSession();
  }
}

async function writeAudit(
  session: ClientSession,
  actorId: Types.ObjectId,
  action: string,
  targetId: Types.ObjectId,
): Promise<void> {
  await AuditLogModel.create(
    [{ actorId, action, targetType: "user", targetId }],
    { session },
  );
}

async function lockAdminChanges(session: ClientSession): Promise<void> {
  await SystemStateModel.updateOne(
    { _id: "active-admin-user-change" },
    { $inc: { revision: 1 } },
    { upsert: true, session },
  ).exec();
}

function handleDuplicateUsername(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  ) {
    throw new ApiError(409, "USERNAME_TAKEN", "Username is already in use");
  }
  throw error;
}

export function assertActiveAdminCanBeRemoved(activeAdminCount: number): void {
  if (activeAdminCount <= 1) {
    throw new ApiError(
      409,
      "LAST_ACTIVE_ADMIN",
      "The last active Admin cannot be deactivated or demoted",
    );
  }
}

export const userManagementService: UserManagementService = {
  async listUsers() {
    const users = await UserModel.find()
      .select(
        "_id username role isActive passwordChangeRequired createdAt updatedAt",
      )
      .sort({ username: 1 })
      .lean()
      .exec();
    return users.map((user) => toSafeUser(user));
  },

  async createUser(actorId, input) {
    const actorObjectId = getActorId(actorId);
    const passwordHash = await hashPassword(input.initialPassword);
    try {
      return await runTransaction(async (session) => {
        const [user] = await UserModel.create(
          [
            {
              username: input.username,
              passwordHash,
              role: input.role,
              isActive: true,
              passwordChangeRequired: true,
            },
          ],
          { session },
        );
        if (!user) throw new Error("Created user was not returned");
        await writeAudit(session, actorObjectId, "user.created", user._id);
        return toSafeUser(user);
      });
    } catch (error) {
      handleDuplicateUsername(error);
    }
  },

  async updateUser(actorId, userId, input) {
    const actorObjectId = getActorId(actorId);
    const targetId = new Types.ObjectId(userId);
    try {
      return await runTransaction(async (session) => {
        const user = await UserModel.findById(targetId).session(session).exec();
        if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

        if (
          input.role === "Engineer" &&
          user.role === "Admin" &&
          user.isActive
        ) {
          await lockAdminChanges(session);
          const activeAdmins = await UserModel.countDocuments({
            role: "Admin",
            isActive: true,
          })
            .session(session)
            .exec();
          assertActiveAdminCanBeRemoved(activeAdmins);
        }

        if (input.username !== undefined) user.username = input.username;
        if (input.role !== undefined) user.role = input.role;
        await user.save({ session });
        await writeAudit(session, actorObjectId, "user.updated", user._id);
        return toSafeUser(user);
      });
    } catch (error) {
      handleDuplicateUsername(error);
    }
  },

  async setUserActive(actorId, userId, isActive) {
    const actorObjectId = getActorId(actorId);
    const targetId = new Types.ObjectId(userId);
    return runTransaction(async (session) => {
      const user = await UserModel.findById(targetId).session(session).exec();
      if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
      if (user.isActive === isActive) {
        throw new ApiError(
          409,
          isActive ? "USER_ALREADY_ACTIVE" : "USER_ALREADY_INACTIVE",
          isActive ? "User is already active" : "User is already inactive",
        );
      }

      if (!isActive && user.role === "Admin") {
        await lockAdminChanges(session);
        const activeAdmins = await UserModel.countDocuments({
          role: "Admin",
          isActive: true,
        })
          .session(session)
          .exec();
        assertActiveAdminCanBeRemoved(activeAdmins);
      }

      user.isActive = isActive;
      await user.save({ session });
      await writeAudit(
        session,
        actorObjectId,
        isActive ? "user.reactivated" : "user.deactivated",
        user._id,
      );
      return toSafeUser(user);
    });
  },
};
