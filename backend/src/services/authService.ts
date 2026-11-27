import { compare } from "bcryptjs";
import { AppDataSource } from "../config/dataSource.js";
import { User } from "../entities/User.js";

export interface SafeUser {
  id: string;
  username: string;
  role: User["role"];
}

export interface AuthService {
  authenticate(username: string, password: string): Promise<SafeUser | null>;
  findActiveById(id: string): Promise<SafeUser | null>;
}

export interface AuthUserStore {
  findForAuthentication(username: string): Promise<User | null>;
  findActiveById(id: string): Promise<User | null>;
}

function toSafeUser(user: User): SafeUser {
  return { id: user.id, username: user.username, role: user.role };
}

export function createAuthService(users: AuthUserStore): AuthService {
  return {
    async authenticate(username, password) {
      const user = await users.findForAuthentication(username);
      if (
        !user ||
        !user.isActive ||
        !(await compare(password, user.passwordHash))
      ) {
        return null;
      }
      return toSafeUser(user);
    },

    async findActiveById(id) {
      const user = await users.findActiveById(id);
      return user ? toSafeUser(user) : null;
    },
  };
}

export const authService: AuthService = createAuthService({
  findForAuthentication(username) {
    return AppDataSource.getRepository(User)
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("LOWER(user.username) = LOWER(:username)", { username })
      .getOne();
  },
  findActiveById(id) {
    return AppDataSource.getRepository(User).findOne({
      select: { id: true, username: true, role: true, isActive: true },
      where: { id, isActive: true },
    });
  },
});
