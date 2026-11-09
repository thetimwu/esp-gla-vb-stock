import { z } from "zod";

const mongoUriSchema = z.string().superRefine((uri, context) => {
  try {
    const parsedUri = new URL(uri);
    if (
      !["mongodb:", "mongodb+srv:"].includes(parsedUri.protocol) ||
      !parsedUri.hostname
    ) {
      context.addIssue({
        code: "custom",
        message: "MONGODB_URI must be a valid MongoDB connection URL",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      message: "MONGODB_URI must be a valid MongoDB connection URL",
    });
  }
});

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: mongoUriSchema,
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  return environmentSchema.parse(source);
}
