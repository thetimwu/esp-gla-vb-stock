import type { SafeUser } from "../services/authService.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
    }
  }
}
