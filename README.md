# Gate Components Inventory Management

A planned internal-LAN web application for tracking gate component quantities, stock movements, and administrative actions. The initial dashboard will contain 10 components; their names, photos, starting quantities, and minimum stock levels are to be provided.

Anyone on the authorised internal company LAN can view, search, and filter current component stock, photos, low-stock warnings, and non-sensitive details without logging in or starting a session. Public component API reads are read-only and do not start a session. Authentication is required for every write and for transaction history; Admin-only user/component management and audit-log access are enforced by the backend when those milestones are implemented.

## Technology

- React, TypeScript, and Vite frontend (planned).
- Node.js, Express.js, and TypeScript backend.
- PostgreSQL 17 with TypeORM and explicit migrations.
- Docker and Docker Compose.
- Initial production host: Windows PC on the internal company LAN; future target: Ubuntu Server.

The current backend milestone provides public read-only health and component endpoints. The database schema is prepared for users, components, stock transactions, and audit logs. Authentication, user-management APIs, stock modifications, and the React frontend are not part of this migration milestone.

## Run locally

Requirements: Node.js 22 or 24, npm, and Docker Compose.

1. Copy `.env.example` to `.env` and set unique private values for the application (`DB_USER`, `DB_PASSWORD`) and bootstrap administrator (`POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD`).
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Build the backend image and apply explicit TypeORM migrations:

   ```sh
   docker compose build backend
   docker compose run --rm backend npm run migration:run
   ```

4. Start the backend: `docker compose up -d backend`.
5. Check `http://localhost:3000/api/health` and `http://localhost:3000/api/components`.

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

The public API exposes read-only health and component endpoints. It does not expose authentication, user-management, or stock-write endpoints in this migration milestone.

## Project documentation

- [Functional requirements and business rules](./docs/requirements.md)
- [Architecture and data boundaries](./docs/architecture.md)
- [Development, deployment, backup, and migration](./docs/deployment.md)
- [GitHub Copilot coding instructions](./.github/copilot-instructions.md)

The root [.env.example](./.env.example) contains placeholders only. Never commit real credentials or secret values.
