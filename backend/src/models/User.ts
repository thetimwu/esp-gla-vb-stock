import { model, Schema, type Types } from "mongoose";

export const USER_ROLES = ["Engineer", "Admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserRecord {
  _id: Types.ObjectId;
  username: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  passwordChangeRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserRecord>(
  {
    username: { type: String, required: true, trim: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true },
    isActive: { type: Boolean, required: true, default: true },
    passwordChangeRequired: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true, strict: "throw" },
);

export const UserModel = model<UserRecord>("User", userSchema, "users");
