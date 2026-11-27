import { hash } from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import { UserRole, type User } from "../entities/User.js";
import {
  createAuthService,
  type AuthUserStore,
} from "../services/authService.js";

function createUser(passwordHash: string, isActive: boolean): User {
  return {
    id: "5f0ff503-32e5-4db4-b06c-4a36aacfa602",
    username: "engineer",
    passwordHash,
    role: UserRole.ENGINEER,
    isActive,
    passwordChangeRequired: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("authentication service", () => {
  it("verifies the password hash and returns no credential fields", async () => {
    const user = createUser(await hash("correct horse battery", 4), true);
    const store: AuthUserStore = {
      findForAuthentication: vi.fn(async () => user),
      findActiveById: vi.fn(async () => user),
    };
    const auth = createAuthService(store);

    await expect(
      auth.authenticate("engineer", "wrong password"),
    ).resolves.toBeNull();
    const authenticated = await auth.authenticate(
      "engineer",
      "correct horse battery",
    );

    expect(authenticated).toEqual({
      id: user.id,
      username: user.username,
      role: UserRole.ENGINEER,
    });
    expect(authenticated).not.toHaveProperty("passwordHash");
  });

  it("rejects inactive users at login and on session revalidation", async () => {
    const user = createUser(await hash("correct horse battery", 4), false);
    const store: AuthUserStore = {
      findForAuthentication: vi.fn(async () => user),
      findActiveById: vi.fn(async () => null),
    };
    const auth = createAuthService(store);

    await expect(
      auth.authenticate("engineer", "correct horse battery"),
    ).resolves.toBeNull();
    await expect(auth.findActiveById(user.id)).resolves.toBeNull();
  });
});
