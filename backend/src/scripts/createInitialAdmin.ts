import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../config/database.js";
import { parseEnvironment } from "../config/env.js";
import { AuditLogModel } from "../models/AuditLog.js";
import { SystemStateModel } from "../models/SystemState.js";
import { UserModel } from "../models/User.js";
import { hashPassword } from "../services/passwordService.js";
import { loginBodySchema } from "../validators/authValidators.js";

class SetupError extends Error {}

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new SetupError("Run this command from an interactive terminal");
  }

  process.stdout.write(prompt);
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = (): void => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(false);
      process.stdout.write("\n");
    };
    const onKeypress = (
      character: string,
      key: { name?: string; ctrl?: boolean },
    ): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new SetupError("Admin setup cancelled"));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value);
      } else if (key.name === "backspace") {
        value = value.slice(0, -1);
      } else if (!key.ctrl && character) {
        value += character;
      }
    };
    input.on("keypress", onKeypress);
  });
}

async function main(): Promise<void> {
  const environment = parseEnvironment();
  const prompt = createInterface({ input: stdin, output: stdout });
  const enteredUsername = await prompt.question("Initial Admin username: ");
  prompt.close();
  const usernameResult = loginBodySchema.safeParse({
    username: enteredUsername,
    password: "placeholder-only",
  });
  if (!usernameResult.success) {
    throw new SetupError(
      "Invalid username; use 3-64 letters, numbers, dots, underscores or hyphens",
    );
  }
  const { username } = usernameResult.data;
  const password = await readHidden("Initial Admin password (input hidden): ");
  const confirmedPassword = await readHidden(
    "Confirm initial Admin password (input hidden): ",
  );
  if (password !== confirmedPassword) {
    throw new SetupError("Passwords do not match");
  }
  if (password.length < 12 || password.length > 128) {
    throw new SetupError("Password must be between 12 and 128 characters");
  }

  await connectToDatabase(environment.MONGODB_URI);
  const session = await UserModel.startSession();
  try {
    const passwordHash = await hashPassword(password);
    await session.withTransaction(async () => {
      const existingAdmin = await UserModel.exists({ role: "Admin" })
        .session(session)
        .exec();
      if (existingAdmin) {
        throw new SetupError("An Admin account already exists");
      }

      await SystemStateModel.create(
        [{ _id: "initial-admin-created", revision: 1 }],
        { session },
      );
      const [user] = await UserModel.create(
        [
          {
            username,
            passwordHash,
            role: "Admin",
            isActive: true,
            passwordChangeRequired: true,
          },
        ],
        { session },
      );
      if (!user) throw new SetupError("Initial Admin creation failed");
      await AuditLogModel.create(
        [
          {
            actorId: user._id,
            action: "user.initial-admin-created",
            targetType: "user",
            targetId: user._id,
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
    await disconnectFromDatabase();
  }

  process.stdout.write("Initial Admin account created.\n");
}

void main().catch((error: unknown) => {
  const message =
    error instanceof SetupError
      ? error.message
      : "Initial Admin setup failed; no credentials were displayed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
