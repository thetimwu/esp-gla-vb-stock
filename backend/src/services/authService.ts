import { Types } from "mongoose";
import { ApiError } from "../errors/ApiError.js";
import { UserModel, type UserRole } from "../models/User.js";
import { hashPassword, verifyPassword } from "./passwordService.js";

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  passwordChangeRequired: boolean;
}

export interface AuthService {
  authenticate(
    username: string,
    password: string,
  ): Promise<AuthenticatedUser | null>;
  findActiveUser(userId: string): Promise<AuthenticatedUser | null>;
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean>;
}

function toAuthenticatedUser(user: {
  _id: Types.ObjectId;
  username: string;
  role: UserRole;
  passwordChangeRequired: boolean;
}): AuthenticatedUser {
  return {
    id: user._id.toString(),
    username: user.username,
    role: user.role,
    passwordChangeRequired: user.passwordChangeRequired,
  };
}

export const authService: AuthService = {
  async authenticate(username, password) {
    const user = await UserModel.findOne({ username })
      .select("+passwordHash")
      .exec();
    const matches = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !user.isActive || !matches) return null;
    return toAuthenticatedUser(user);
  },

  async findActiveUser(userId) {
    if (!Types.ObjectId.isValid(userId)) return null;
    const user = await UserModel.findOne({
      _id: userId,
      isActive: true,
    }).exec();
    return user ? toAuthenticatedUser(user) : null;
  },

  async changePassword(userId, currentPassword, newPassword) {
    const user = await UserModel.findOne({
      _id: userId,
      isActive: true,
    })
      .select("+passwordHash")
      .exec();
    if (!user) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication required",
      );
    }

    const matches = await verifyPassword(currentPassword, user.passwordHash);
    if (!matches) return false;

    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangeRequired = false;
    await user.save();
    return true;
  },
};
