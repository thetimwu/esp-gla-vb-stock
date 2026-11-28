# Gate Components Inventory Management

An internal-LAN web application for tracking gate component quantities, stock movements, and administrative actions. The public React dashboard is read-only and available without login. The initial inventory will contain 10 components; their names, photos, starting quantities, and minimum stock levels are to be provided.

Anyone on the authorised internal company LAN can view current component stock, component details, and stock statistics without logging in. The frontend restores an existing session without redirecting public visitors and asks users to sign in only when they choose Login or attempt a future protected action. There is no public registration. The backend enforces active-account and role checks; Engineers can view history, while Admins can manage components and users and view audit logs. Stock mutation endpoints and management screens are not implemented yet.

## Technology

- React, TypeScript, and Vite public dashboard and sign-in interface.
- Node.js, Express.js, and TypeScript backend.
- PostgreSQL 17 with TypeORM and explicit migrations.
- Docker and Docker Compose.
- Initial production host: Windows PC on the internal company LAN; future target: Ubuntu Server.

The backend provides public health, component, and statistics endpoints; PostgreSQL-backed login sessions; CSRF and login rate limiting; protected transaction-history reads; and Admin-only component/user/audit APIs. Stock quantity updates remain unimplemented.

## Run locally

Requirements: Node.js 22 or 24, npm, and Docker Compose.

1. Copy `.env.example` to `.env` and set unique private values for the application (`DB_USER`, `DB_PASSWORD`), bootstrap database administrator (`POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD`), and `SESSION_SECRET`.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Build the backend image and apply explicit TypeORM migrations:

   ```sh
   docker compose build backend
   docker compose run --rm backend npm run migration:run
   ```

4. Create the first application administrator: `docker compose run --rm backend node dist/scripts/createAdmin.js`.
5. Start the backend: `docker compose up -d backend`.
6. Check `http://localhost:3000/api/health`, `http://localhost:3000/api/components`, and `http://localhost:3000/api/statistics`.

7. Start the frontend development server on the host:

   ```sh
   cd frontend
   cp .env.example .env
   npm ci
   npm run dev
   ```

   Open `http://localhost:5173`. Alternatively, from the project root, start the optional Compose frontend with `docker compose --profile frontend up -d --build frontend`; it proxies `/api` to the backend without exposing database credentials to the browser.

PostgreSQL 17 uses the persistent named volume `postgres_data`. An initialization script creates a separate application role with schema permissions; the backend does not connect as the database administrator. Initialization runs only when the data volume is empty. Its port is published on `127.0.0.1:5432` for local host-based development only; it is not exposed to the company LAN. The backend waits for PostgreSQL readiness. The backend API and frontend are published on localhost by default; for authorised LAN dashboard testing, change only `FRONTEND_HOST_BIND` to an approved LAN host address and configure the company firewall. Keep `API_HOST_BIND` and PostgreSQL loopback-only unless a separately approved architecture requires direct access. `docker compose down` stops containers but preserves the database volume. The frontend Compose profile runs Vite's development server and is not a production static-serving configuration.

Migrations are never run automatically on application startup. For later schema updates, rebuild the backend image, run `docker compose run --rm backend npm run migration:run`, then recreate the backend with `docker compose up -d --build backend`. To run migrations from a host development environment, use `npm run migration:run:dev` in `backend/` with the database environment variables configured.

## Database backup and restore

Create a PostgreSQL custom-format backup:

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > gate-inventory.dump
```

For restore, stop application writes and confirm the target is the intended database. The following `--clean` restore replaces objects in that database:

```sh
docker compose stop backend
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < gate-inventory.dump
```

Store backups separately from the Docker host and test restores. Production backup frequency, retention, off-host storage, encryption, and recovery objectives must be agreed before deployment.

## Backend checks

Create a separate disposable test database owned by the application role before running integration tests:

```sh
docker compose exec postgres sh -c 'createdb --username "$POSTGRES_USER" --owner "$DB_USER" gate_inventory_test'
```

From `backend/`, set `DB_NAME=gate_inventory_test` for the test command after running `npm ci`:

- `DB_NAME=gate_inventory_test npm test` — Vitest/Supertest tests (includes PostgreSQL integration tests).
- `npm run typecheck` — TypeScript checks.
- `npm run lint` — ESLint.
- `npm run format:check` — Prettier validation.
- `npm run build` — production TypeScript build.

Public endpoints are `GET /api/health`, `/api/components`, `/api/components/:id`, and `/api/statistics`. Authentication uses `/api/auth/csrf-token`, `/api/auth/login`, `/api/auth/session`, and `/api/auth/logout`. Protected history and admin endpoints are documented in [architecture](./docs/architecture.md). Stock mutation endpoints are intentionally not implemented.

Frontend checks from `frontend/`:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Public inventory requests use only the public component and statistics GET endpoints and omit credentials. Authentication uses the existing session and CSRF endpoints with cookies; passwords and CSRF tokens are not stored in browser persistence. Copy `frontend/.env.example` to `frontend/.env` for host development; `VITE_API_BASE_URL` is a public URL path, while `API_PROXY_TARGET` is used only by the Vite server. Neither variable contains credentials.

## Project documentation

- [Functional requirements and business rules](./docs/requirements.md)
- [Architecture and data boundaries](./docs/architecture.md)
- [Development, deployment, backup, and migration](./docs/deployment.md)
- [GitHub Copilot coding instructions](./.github/copilot-instructions.md)

The root [.env.example](./.env.example) contains placeholders only. Never commit real credentials or secret values.
