# Gate Components Inventory Management — Deployment

## Deployment goals

The initial installation runs on a Windows PC on the internal company LAN using Docker Desktop and Docker Compose. The application must not be reachable from the public internet, and client devices must not have direct access to MongoDB. The design should remain portable to Ubuntu Server.

No containers or host configuration are created by this document. Exact ports, hostnames, TLS arrangements, backup tooling, and operating procedures remain to be agreed.

## Ubuntu development environment

Develop on Ubuntu/Linux with VS Code and GitHub Copilot Agent. The eventual development setup will use the agreed React/TypeScript/Vite frontend, Node.js/Express/TypeScript backend, MongoDB, and Docker Compose. Keep environment-specific configuration out of source control and use `.env.example` as a placeholder-only guide.

### Start the local stack

From the project root:

1. Copy `.env.example` to `.env`; replace all placeholder values with unique local database credentials. Ensure the URI username/password match the Mongo app-user variables and URL-encode reserved characters in the URI.
2. Generate a stable session secret with `openssl rand -hex 32` and set `SESSION_SECRET` in `.env`. Keep it private and unchanged across backend restarts.
3. Run `docker compose up --build`.
4. Create the first Admin with `docker compose exec -it backend npm run create-admin`. Enter the username and password interactively; the password prompt is hidden. This command refuses to create a duplicate initial Admin; the bootstrap Admin must change that password after logging in.
5. Check `http://localhost:3000/api/health` and `http://localhost:3000/api/components`.
6. Stop with `docker compose down`. This preserves the named MongoDB data volume; do not use `down -v` for normal shutdown.

Compose starts MongoDB with authentication and a single-node replica set named `rs0`. On the first fresh data volume, MongoDB's official initialization flow creates the root account and runs the checked-in initialization script to create a database-scoped `readWrite` account. The Mongo health check idempotently initiates the replica set and waits for it to become primary; the backend waits for this healthy status before starting. The API uses the application account, and the MongoDB port is not published to the host.

The Mongo initialization script only runs against an empty data directory. Changing user/password variables in `.env` does not rotate existing credentials. Use the approved MongoDB credential-rotation procedure when changing them. The generated replica-set keyfile is ephemeral and appropriate only for this single-node container setup; configure a managed, persistent keyfile before expanding to multiple replica-set members.

Express sessions are stored in MongoDB's `sessions` collection and expire after eight hours. Do not change `SESSION_SECRET` during normal restarts, because doing so invalidates existing cookies. `HTTPS_ENABLED=false` is appropriate for local HTTP. Set it to `true` only when HTTPS terminates at a trusted reverse proxy; the application then marks cookies Secure and trusts the proxy's forwarded protocol.

The API issues session-backed CSRF tokens at `GET /api/auth/csrf-token`. Clients must send the returned value in the `x-csrf-token` header on login, logout, password changes, and all other state-changing requests. Login rotates both the session ID and CSRF token.

### Backend development and checks

From `backend/`, use Node.js 22 or 24 and run:

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`npm run dev` expects `MONGODB_URI` to point to a reachable replica set. The Compose MongoDB service is intentionally not published to the host; use `docker compose up --build` for the integrated local stack, or configure an independently reachable development replica set for a host-run backend process. No database or application secrets are provided by the repository.

Exact deployment versions and production-specific configuration should be reviewed before company LAN release.

## Windows host deployment with Docker Desktop

### Preparation

- Select a supported Windows edition and install/configure Docker Desktop according to company policy. Confirm the required virtualization and WSL 2 or Hyper-V prerequisites with the host administrator.
- Keep the host patched and access-controlled. Use an account with the minimum permissions required to administer the deployment.
- Agree on a stable LAN hostname or reserved IP, application port, TLS/certificate approach, and firewall owner before exposing the service to users.
- Prepare an environment file on the host from the placeholder template. Set unique production secrets and database credentials outside source control; restrict file access.

### Service topology

- Run the web application and MongoDB through Docker Compose.
- Configure MongoDB as a single-node replica set for the initial single-server deployment so transaction-backed stock writes are supported.
- Persist MongoDB data in a named Docker volume or another explicitly managed persistent location. Do not depend on the container writable layer for database persistence.
- Keep MongoDB on an internal Docker network. Do not publish the MongoDB port to the LAN.
- Publish only the application endpoint required by LAN clients, and limit inbound host firewall rules to the internal company network and agreed port.
- Do not configure internet port forwarding or public DNS for this application.

The exact Compose file, image versions, ports, network names, health checks, and resource limits will be decided and tested during implementation.

### LAN access and authentication

Users access the application through the approved LAN hostname/IP and application endpoint. Network/firewall controls restrict reachability to the authorised internal LAN. Any visitor on that LAN can view, search, and filter the component dashboard, photos, current quantities, low-stock warnings, and non-sensitive component details without logging in, creating an account, or starting a session.

Authentication is required before any data-changing operation. Engineer and Admin capabilities, transaction-history access, and all other protected reads require authentication; Admin-only actions and audit-log access additionally require the Admin role. The backend must enforce these rules, and public GET responses must not reveal credentials, session data, sensitive user information, transaction history, or administrative audit logs. LAN-only reachability does not replace these application-level controls.

TLS on the LAN, certificate issuance and renewal, DNS, firewall rules, and remote/VPN access policy require coordination with the company administrator; do not assume plaintext HTTP is acceptable for production.

## Persistent storage and photos

MongoDB data must survive container recreation, image upgrades, and host reboots by using a managed persistent volume/location. Container replacement must not be treated as a backup.

Photo storage has not been selected. Before implementation, decide whether photos are stored in MongoDB, on a persistent filesystem/volume, or in another approved storage service. Whichever approach is selected must define size/type limits, access controls, backup coverage, and migration behavior. Do not place unbacked uploads in an ephemeral container filesystem.

## Backup and restore

### Backup requirements

- Back up the database and any separately stored component photos/configuration needed to restore the application.
- Use a MongoDB-aware backup method that produces a consistent, restorable backup for the selected replica-set deployment.
- Store backups separately from the host's primary Docker data location; protect them with appropriate access controls and encryption at rest where required by company policy.
- Define backup frequency, retention, off-host copy, encryption/key management, recovery point objective, and recovery time objective before production use.
- Monitor backup completion and periodically test restoration. A backup that has not been restore-tested is not a verified recovery plan.

### Restore outline

1. Restrict or stop application access to prevent writes during recovery.
2. Preserve the current data directory/volume before replacing or restoring anything, so the existing state is not destroyed inadvertently.
3. Restore the database using the selected MongoDB-aware procedure and restore photo files and required configuration from the matching backup.
4. Start the replica set and application using the documented deployment configuration.
5. Verify database health, authentication, representative component quantities, transaction history, and photo availability.
6. Re-enable LAN access only after verification, and record the recovery event.

Exact backup/restore commands, tool versions, schedules, retention, and recovery objectives are open operational decisions and must be documented and tested before production.

## Updates and operations

Deployments should use reviewed, versioned application and container images. Back up before upgrades that may change persistent data. Document the deployed version, configuration changes, and recovery path. Monitor service health, available disk space, backup status, and application/database logs without logging passwords, session secrets, or other sensitive values.

## Future migration to Ubuntu Server

The deployment should avoid Windows-only application behavior and keep configuration portable. To migrate:

1. Provision and secure an approved Ubuntu Server host, Docker Engine/Compose, LAN identity, firewall rules, and TLS arrangement.
2. Stop writes on the Windows deployment and take a verified MongoDB backup plus a matching photo/configuration backup.
3. Transfer backups securely and restore them to a MongoDB replica set on Ubuntu.
4. Apply the Ubuntu host's protected environment configuration and persistent storage setup.
5. Verify component counts/quantities, transaction and audit history, user access, photos, and application health.
6. Switch the agreed LAN hostname/IP routing only after validation; retain the old host and backup until acceptance is complete.

Downtime, data cutover approach, hostname/IP changes, rollback window, and responsibility for migration remain to be agreed.
