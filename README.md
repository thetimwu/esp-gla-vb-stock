# Gate Components Inventory Management

A planned internal-LAN web application for tracking gate component quantities, stock movements, and administrative actions. The initial dashboard will contain 10 components; their names, photos, starting quantities, and minimum stock levels are to be provided.

Anyone on the authorised internal company LAN can view current component stock, component details, and stock statistics without logging in or starting a session. Login is required only for transaction history and protected actions. The backend enforces active-account and role checks; Engineers can view history, while Admins can manage components and users and view audit logs. Stock mutation endpoints are not implemented yet.

## Technology

- React, TypeScript, and Vite frontend (planned).
- Node.js, Express.js, and TypeScript backend.
- PostgreSQL 17 with TypeORM and explicit migrations.
- Docker and Docker Compose.
- Initial production host: Windows PC on the internal company LAN; future target: Ubuntu Server.

The backend provides public health, component, and statistics endpoints; PostgreSQL-backed login sessions; CSRF and login rate limiting; protected transaction-history reads; and Admin-only component/user/audit APIs. Stock quantity updates and the React frontend are not implemented in this milestone.

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

PostgreSQL 17 uses the persistent named volume `postgres_data`. An initialization script creates a separate application role with schema permissions; the backend does not connect as the database administrator. Initialization runs only when the data volume is empty. Its port is published on `127.0.0.1:5432` for local host-based development only; it is not exposed to the company LAN. The backend waits for PostgreSQL readiness. The public API is published on localhost by default; change `API_HOST_BIND` to the approved LAN host address only for an authorised deployment. `docker compose down` stops containers but preserves the database volume.

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

## Project documentation

- [Functional requirements and business rules](./docs/requirements.md)
- [Architecture and data boundaries](./docs/architecture.md)
- [Development, deployment, backup, and migration](./docs/deployment.md)
- [GitHub Copilot coding instructions](./.github/copilot-instructions.md)

The root [.env.example](./.env.example) contains placeholders only. Never commit real credentials or secret values.
