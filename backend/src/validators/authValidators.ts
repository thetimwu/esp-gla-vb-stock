import { z } from "zod";

export const emptyObjectSchema = z.object({}).strict();

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .transform((username) => username.toLowerCase());

const passwordSchema = z.string().min(12).max(128);

export const loginBodySchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict();

export const createUserBodySchema = z
  .object({
    username: usernameSchema,
    role: z.enum(["Engineer", "Admin"]),
    initialPassword: passwordSchema,
  })
  .strict();

export const updateUserBodySchema = z
  .object({
    username: usernameSchema.optional(),
    role: z.enum(["Engineer", "Admin"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one user field must be provided",
  });

export const userIdParamsSchema = z
  .object({
    userId: z.string().regex(/^[a-f\d]{24}$/i),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
