import { createInterface } from "node:readline/promises";
import { hash } from "bcryptjs";
import { AppDataSource } from "../config/dataSource.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../config/database.js";
import { User, UserRole } from "../entities/User.js";

function askUsername(): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return readline.question("First administrator username: ").finally(() => {
    readline.close();
  });
}

function askHiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error("Administrator creation requires an interactive terminal"),
    );
  }
  process.stdout.write("First administrator password (12+ characters): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Administrator creation cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else if (character >= " " && character !== "\u007f") {
          password += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function createFirstAdmin(): Promise<void> {
  await connectToDatabase();
  try {
    const users = AppDataSource.getRepository(User);
    const activeAdminCount = await users.count({
      where: { role: UserRole.ADMIN, isActive: true },
    });
    if (activeAdminCount > 0) {
      throw new Error(
        "An active administrator already exists; use authenticated user management instead",
      );
    }

    const username = (await askUsername()).trim();
    if (!username || username.length > 100) {
      throw new Error("Username must contain 1 to 100 characters");
    }
    const password = await askHiddenPassword();
    if (
      password.length < 12 ||
      password.length > 72 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      throw new Error("Password must contain 12 to 72 UTF-8 bytes");
    }

    await users.save({
      username,
      passwordHash: await hash(password, 12),
      role: UserRole.ADMIN,
      isActive: true,
    });
    process.stdout.write(`Created the first administrator "${username}".\n`);
  } finally {
    await disconnectFromDatabase();
  }
}

void createFirstAdmin().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Administrator creation failed"}\n`,
  );
  process.exitCode = 1;
});
