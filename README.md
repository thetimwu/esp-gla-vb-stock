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

The backend foundation is implemented in [backend/](./backend/). The React frontend and authenticated/write operations are planned for later milestones.

## Run locally

Requirements: Node.js 22 or 24, npm, and Docker Compose.

1. Copy `.env.example` to `.env` and replace every placeholder with unique local values. URL-encode MongoDB username/password values in `MONGODB_URI`.
2. From the project root, run `docker compose up --build`.
3. Check `http://localhost:3000/api/health` and `http://localhost:3000/api/components`.

MongoDB runs as a single-node `rs0` replica set, uses an application-scoped database user, and is not published to the host. The backend is published on localhost by default; change `API_HOST_BIND` to the approved LAN host address only when deploying on an authorised network. MongoDB initialization scripts run only when its named volume is first created. Changing credentials after initialization requires a documented database credential rotation, not just editing `.env`.

## Backend checks

From `backend/`, run `npm ci`, then:

- `npm test` — Vitest/Supertest tests.
- `npm run typecheck` — TypeScript checks.
- `npm run lint` — ESLint.
- `npm run format:check` — Prettier validation.
- `npm run build` — production TypeScript build.

The public API currently exposes read-only health and component endpoints. Component writes, authentication, and the React UI are not part of this milestone.

## Project documentation

- [Functional requirements and business rules](./docs/requirements.md)
- [Architecture and data boundaries](./docs/architecture.md)
- [Development, deployment, backup, and migration](./docs/deployment.md)
- [GitHub Copilot coding instructions](./.github/copilot-instructions.md)

The root [.env.example](./.env.example) contains placeholders only. Never commit real credentials or secret values.
