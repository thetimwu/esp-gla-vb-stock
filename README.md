# Gate Components Inventory Management

A planned internal-LAN web application for tracking gate component quantities, stock movements, and administrative actions. The initial dashboard will contain 10 components; their names, photos, starting quantities, and minimum stock levels are to be provided.

Anyone on the authorised internal company LAN can view, search, and filter current component stock, photos, low-stock warnings, and non-sensitive details without logging in or starting a session. Public component API reads are read-only and do not start a session. Authentication is required for every write and for transaction history; Admin-only user/component management and audit-log access are enforced by the backend.

## Planned technology

- React, TypeScript, and Vite frontend.
- Node.js, Express.js, and TypeScript backend.
- MongoDB with Mongoose, configured as a replica set for atomic inventory transactions.
- Docker and Docker Compose for deployment.
- Initial production host: Windows PC on the internal company LAN.
- Future migration target: Ubuntu Server.

The backend foundation and Milestone 2 authentication/user-management APIs are implemented in [backend/](./backend/). The React frontend and inventory write operations are planned for later milestones.

## Run locally

Requirements: Node.js 22 or 24, npm, and Docker Compose.

1. Copy `.env.example` to `.env` and replace every placeholder with unique local values. URL-encode MongoDB username/password values in `MONGODB_URI`. Generate `SESSION_SECRET` with `openssl rand -hex 32` and keep it stable across container restarts.
2. From the project root, run `docker compose up --build`.
3. Create the first Admin interactively: `docker compose exec -it backend npm run create-admin`. Enter a username, then a password of at least 12 characters twice; password input is hidden. This command is one-time and refuses to create another initial Admin. The bootstrap Admin must change this password after logging in.
4. Check `http://localhost:3000/api/health` and `http://localhost:3000/api/components`.

MongoDB runs as a single-node `rs0` replica set, uses an application-scoped database user, and is not published to the host. The backend is published on localhost by default; change `API_HOST_BIND` to the approved LAN host address only when deploying on an authorised network. MongoDB initialization scripts run only when its named volume is first created. Changing credentials after initialization requires a documented database credential rotation, not just editing `.env`.

Authentication uses MongoDB-backed eight-hour sessions. The browser first requests `GET /api/auth/csrf-token`, then includes the returned token in the `x-csrf-token` header for `POST`, `PATCH`, and `DELETE` requests, including login and logout. Successful login returns a rotated CSRF token. `HTTPS_ENABLED=true` must only be used behind a trusted HTTPS reverse proxy; it enables Secure cookies and proxy protocol handling. For local HTTP, leave it `false`.

The initial Admin setup command and application require the same configured `MONGODB_URI` and `SESSION_SECRET`. The CLI never prints the entered password or stored hash. All new accounts, including the bootstrap Admin, must change their initial password through `POST /api/auth/password-change`.

## Backend checks

From `backend/`, run `npm ci`, then:

- `npm test` — Vitest/Supertest tests.
- `npm run typecheck` — TypeScript checks.
- `npm run lint` — ESLint.
- `npm run format:check` — Prettier validation.
- `npm run build` — production TypeScript build.

The public API exposes read-only health and component endpoints. Authentication and Admin user-management APIs are implemented; component writes and the React UI are not part of this milestone.

## Project documentation

- [Functional requirements and business rules](./docs/requirements.md)
- [Architecture and data boundaries](./docs/architecture.md)
- [Development, deployment, backup, and migration](./docs/deployment.md)
- [GitHub Copilot coding instructions](./.github/copilot-instructions.md)

The root [.env.example](./.env.example) contains placeholders only. Never commit real credentials or secret values.
