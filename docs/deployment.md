# Gate Components Inventory Management — Deployment

## Deployment goals

The initial installation is planned for a Windows PC on the internal company LAN using Docker Desktop and Docker Compose. The application must not be reachable from the public internet, and client devices must not have direct access to PostgreSQL. The deployment should remain portable to Ubuntu Server.

The checked-in Compose stack uses PostgreSQL 17, persists database files in the named `postgres_data` volume, and publishes PostgreSQL only on `127.0.0.1:5432` for local host-based development. Production LAN access, TLS, firewall rules, backups, and recovery objectives require approval before release.

## Configuration and prerequisites

- Node.js 22 or 24, npm, and Docker Compose for development.
- Copy `.env.example` to `.env`; replace both the application credentials (`DB_USER`, `DB_PASSWORD`) and bootstrap administrator credentials (`POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD`) with unique private values.
- Keep `.env`, database credentials, and backups out of source control. The checked-in `.env.example` contains placeholders only.
- Local `.env` defaults `DB_HOST=127.0.0.1`; Compose overrides the backend host to `postgres` on the private Docker network.

Environment values used by the backend are `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `SESSION_SECRET`. Set `SESSION_SECRET` to a unique cryptographically random value of at least 32 characters. `TRUST_PROXY_HOPS` defaults to `0`; set it to the exact number of trusted reverse-proxy hops only when the backend port is firewalled to those proxies. Production must terminate TLS at the trusted proxy because production session cookies are Secure. `API_HOST_BIND` and `API_HOST_PORT` control the backend host binding/port. PostgreSQL 17 is declared as `postgres:17-alpine` in Compose. A first-volume initialization script creates the separate application role with permissions to apply migrations in the database schema; the backend never uses the bootstrap administrator account. The script runs only when the named volume is first initialized. Credentials are only read from environment configuration and are not logged.

## Start PostgreSQL and the backend with Docker Compose

From the project root:

1. Copy `.env.example` to `.env` and set `DB_USER` and `DB_PASSWORD`.
2. Start the database and wait until it is healthy:

   ```sh
   docker compose up -d postgres
   docker compose ps
   ```

3. Build the backend image and apply pending migrations:

   ```sh
   docker compose build backend
   docker compose run --rm backend npm run migration:run
   ```

4. Create the first application administrator from an interactive terminal. This prompts for the username and a non-echoed password, hashes the password, and refuses if an active ADMIN already exists:

   ```sh
   docker compose run --rm backend node dist/scripts/createAdmin.js
   ```

5. Start or rebuild the backend:

   ```sh
   docker compose up -d --build backend
   ```

6. Check the live PostgreSQL-backed health, public component, and statistics endpoints:

   ```sh
   curl --fail http://localhost:3000/api/health
   curl --fail http://localhost:3000/api/components
   curl --fail http://localhost:3000/api/statistics
   ```

The backend waits for PostgreSQL readiness, but migrations are intentionally not run automatically during startup. The health endpoint performs a database query and returns 503 when PostgreSQL is unavailable. Keep the backend API and PostgreSQL loopback-only for dashboard access; the Vite proxy reaches the backend over the Compose application network. Change `FRONTEND_HOST_BIND` to an approved LAN host address only for authorised LAN dashboard testing, with the company firewall configured accordingly.

Use `docker compose down` for a normal stop; it preserves `postgres_data`. Do not use volume-removal commands as part of routine shutdown. The official image's administrator configuration and application-role initialization apply only when initializing an empty volume. Editing `.env` does not rotate existing PostgreSQL credentials; use an approved database credential-rotation procedure.

## Public dashboard development

The frontend is a React/TypeScript/Vite development application. It calls only public `GET /api/components`, `GET /api/components/:componentId`, and `GET /api/statistics`; Vite proxies `/api` to the backend, so browser requests are same-origin and do not require CORS configuration or session credentials.

For host-based development, start the backend as above, then:

```sh
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:5173`. The frontend `.env.example` sets `VITE_API_BASE_URL=/api` and a server-only `API_PROXY_TARGET=http://127.0.0.1:3000`. To use the optional Compose frontend development profile, start the integrated services with `docker compose --profile frontend up -d --build`; the profile's default frontend host binding is loopback-only. Set only `FRONTEND_HOST_BIND` to an approved LAN host address and configure the host firewall before testing from authorised LAN clients; keep the API and PostgreSQL host bindings private.

The Compose profile runs Vite's development server, not a production static web server. Do not use it as the production deployment. Production static hosting, TLS termination, and the approved frontend serving/reverse-proxy arrangement remain deployment decisions.

## Run the backend directly on the host

The database port is published on loopback to support local host-based development. With PostgreSQL running, configure the database variables in `.env`, then from `backend/`:

```sh
npm ci
npm run migration:run:dev
npm run dev
```

`dotenv` loads the root `.env` for local commands. For the integrated stack, use Docker Compose as described above.

## Backend checks

From `backend/`:

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Use Node.js 24 and a separate, disposable PostgreSQL test instance. The integration suite refuses to start unless `NODE_ENV=test`, `DB_HOST` is loopback, and `DB_NAME` contains a standalone `test` token. Never point it at development or production data. For example:

```sh
docker run --rm --detach \
  --name gate-inventory-test-postgres \
  --publish 127.0.0.1:55439:5432 \
  --tmpfs /var/lib/postgresql/data:rw,size=1g \
  --env POSTGRES_USER=gate_test_runner \
  --env POSTGRES_PASSWORD=temporary-test-only \
  --env POSTGRES_DB=gate_inventory_test \
  postgres:17-alpine

docker exec gate-inventory-test-postgres pg_isready \
  -U gate_test_runner -d gate_inventory_test

NODE_ENV=test \
DB_HOST=127.0.0.1 \
DB_PORT=55439 \
DB_NAME=gate_inventory_test \
DB_USER=gate_test_runner \
DB_PASSWORD=temporary-test-only \
SESSION_SECRET=unit-test-session-secret-with-more-than-32-characters \
npm test
```

`npm test` runs both the PostgreSQL integration suite and isolated API/auth tests. `npm run test:integration` runs only the integration suite. Both apply TypeORM migrations to the configured test database and create/remove only uniquely identified fixture rows. The example uses a temporary filesystem, not a Docker volume; stopping the named disposable container discards only its test data.

For a host-based development setup, run the migration then execute `npm run admin:create` from `backend/` to create the first administrator. The password is entered without terminal echo. Do not put an administrator password in a command-line argument or source-controlled file.

### Dependency audit

The current production audit reports three moderate advisories in the TypeORM dependency chain (`typeorm@0.3.31` → `glob@10.5.0` → `minimatch@9.0.9`): a glob cancellation bypass and minimatch glob-pattern amplification. The API configures entities and migrations explicitly and does not accept glob patterns from requests, which limits exposure to those code paths but does not remove the dependency advisory. npm currently recommends TypeORM 1.1.3, a breaking major upgrade. Do not apply that fix automatically; first review TypeORM 1 migration/API compatibility with PostgreSQL 17 and Node 24, then rerun the integration suite. Adopt a compatible patched TypeORM 0.3 release if one becomes available.

## Migrations and releases

Schema changes must be delivered as reviewed TypeORM migrations. Do not enable TypeORM `synchronize`, and do not couple schema migration to the API's normal start command.

For a release that includes a migration:

1. Take and verify a database backup.
2. Build the reviewed backend image.
3. Run `docker compose run --rm backend npm run migration:run`.
4. Recreate the service with `docker compose up -d --build backend`.
5. Check `/api/health`, `/api/components`, and application logs.

## Windows host deployment and LAN access

- Install and configure Docker Desktop according to company policy, including approved virtualization prerequisites.
- Use a host account with minimum required administrative privileges and keep the host patched.
- Prepare an environment file outside source control and restrict access to it.
- Publish only the API endpoint needed by LAN clients, and limit inbound host firewall rules to the authorised company network and agreed port.
- Do not configure internet port forwarding or public DNS.
- Keep PostgreSQL on the internal Docker network; its Compose host binding is loopback-only.
- Coordinate TLS termination, certificates, DNS, firewall ownership, and remote/VPN access with the company administrator.

Any visitor on the authorised LAN may browse public component information and statistics without login or session. Login and protected actions use a PostgreSQL-backed session; all state-changing routes require a CSRF token and Admin-only APIs enforce the role on the backend. LAN-only reachability does not replace backend authentication and authorization.

## Persistent data, photos, and backup

PostgreSQL data persists in the named `postgres_data` volume across container recreation and host reboots. Container replacement is not a backup. Photo storage has not been selected; before photo uploads are implemented, decide its persistent storage, file limits, access controls, and backup coverage.

Create a PostgreSQL custom-format backup:

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > gate-inventory.dump
```

Keep the backup separately from the Docker host's primary data and protect it with access controls and encryption where company policy requires. Define backup frequency, retention, off-host copy, key management, recovery point objective, and recovery time objective before production use. Monitor backup completion and periodically verify restoration.

### Restore

Restore replaces database objects in the selected database. Confirm the target database and preserve an additional copy of its current state before proceeding:

```sh
docker compose stop backend
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < gate-inventory.dump
docker compose up -d backend
```

Verify database health and representative component data before reopening LAN access. Restore any separately stored photos/configuration from the matching backup.

## Future migration to Ubuntu Server

1. Provision and secure the approved Ubuntu host, Docker Engine/Compose, LAN identity, firewall, TLS, and persistent storage.
2. Stop writes and take a verified PostgreSQL backup plus any matching photo/configuration backup.
3. Transfer backups securely and restore them to PostgreSQL 17 or a reviewed compatible version.
4. Apply the Ubuntu host's protected environment configuration and run pending TypeORM migrations.
5. Verify health, component quantities, access controls, and photo availability.
6. Switch the agreed LAN hostname/IP only after validation; retain the old host and backups through the acceptance period.

Downtime, cutover approach, rollback window, hostname/IP changes, and migration ownership remain to be agreed.
