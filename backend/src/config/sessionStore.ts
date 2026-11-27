import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { Pool } from "pg";
import { parseEnvironment } from "./env.js";

const environment = parseEnvironment();
if (!environment.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be configured before starting the API");
}
const PgSessionStore = connectPgSimple(session);
const sessionPool = new Pool({
  host: environment.DB_HOST,
  port: environment.DB_PORT,
  database: environment.DB_NAME,
  user: environment.DB_USER,
  password: environment.DB_PASSWORD,
});

export const postgresSessionStore = new PgSessionStore({
  pool: sessionPool,
  tableName: "sessions",
  createTableIfMissing: false,
});

export const sessionMiddleware = session({
  name: "gate_inventory.sid",
  secret: environment.SESSION_SECRET,
  store: postgresSessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: environment.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
  },
});

export async function closeSessionPool(): Promise<void> {
  await sessionPool.end();
}
