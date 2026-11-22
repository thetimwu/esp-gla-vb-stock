# Gate Components Inventory Management — Architecture

## Agreed technology

- **Frontend:** React, TypeScript, and Vite (planned).
- **Backend:** Node.js, Express.js, and TypeScript.
- **Database:** PostgreSQL 17 with TypeORM and explicit migrations.
- **Deployment:** Docker and Docker Compose.
- **Initial host:** Windows PC on the internal company LAN, using Docker Desktop.
- **Future target:** Ubuntu Server.

The database schema is a foundation only. This migration milestone does not implement authentication, user-management APIs, stock modifications, audit APIs, or the frontend.

## System boundaries

```text
Browser on company LAN
        |
        | public read API; future authenticated requests
        v
React + TypeScript frontend (planned)
        |
        v
Express + TypeScript backend
        |
        | TypeORM; PostgreSQL transactions
        v
PostgreSQL 17 (private Docker network)
```

Browsers never connect to PostgreSQL directly. Public component endpoints remain unauthenticated, read-only, and session-free. Authentication is required for every future write and protected read; Admin authorization is required for future administrative operations. The backend is the sole authority for validation, authorization, business rules, and persistence. PostgreSQL is on the internal Docker network and is not exposed to the LAN. The Compose development port binding is localhost-only.

## Backend responsibilities

Keep HTTP routing, request validation, business rules, authorization, persistence, and response/error mapping distinct. Routes/controllers must not bypass business rules by writing directly to repositories.

- Keep `GET /api/health`, `GET /api/components`, and `GET /api/components/:id` public and read-only.
- Public component responses include only the component UUID, name as `displayName`, current quantity, minimum stock level, and photo reference. They do not expose JSONB attributes, credentials, sessions, users, transactions, or audit data.
- Validate UUID route parameters before querying PostgreSQL and return safe errors without exposing database internals.
- In future milestones require authentication and an active account for every write and protected read. Require Admin for user administration, component administration, archiving, and audit-log access.
- Use explicit TypeORM migrations. `synchronize` and automatic migration-on-startup remain disabled.
- Keep secrets in environment configuration, not source control or logs.

## PostgreSQL entities and constraints

The initial migration creates four tables. No users, components, stock transactions, audit logs, or initial quantities are seeded.

### `users`

- UUID primary key.
- Username with a case-insensitive unique index and non-empty check.
- Password hash (excluded from ordinary entity selections).
- Role enum: `ADMIN` or `ENGINEER`.
- Active/inactive and require-password-change booleans.
- Created and updated `timestamptz` columns.

### `components`

- UUID primary key, required name, description, optional part number, and optional photo path.
- Integer current quantity and minimum stock level, defaulting to zero and constrained to non-negative values.
- Flexible JSONB attributes.
- Active/archived state (`is_active`) and created/updated timestamps.
- Index on active state and name.

The API keeps the existing public response shape (`displayName`, `photoUrl`); these map to the entity's `name` and `photoPath`. Attributes remain private until supported public fields and validation are defined. No component data is seeded.

### `stock_transactions`

- UUID primary key and required component/user foreign keys with delete restricted.
- Action enum: `STOCK_IN`, `STOCK_OUT`, or `ADJUSTMENT`.
- Previous quantity, new quantity, and quantity change are integers.
- Database checks require non-negative previous/new values and `quantity_change = new_quantity - previous_quantity`.
- Optional comment and server-generated creation timestamp.
- Component/time and user/time indexes.

### `audit_logs`

- UUID primary key, nullable user foreign key (`SET NULL` on user deletion), action, entity type, and UUID entity ID.
- JSONB details and server-generated creation timestamp.
- Entity/time and user/time indexes.

Ordinary application workflows must deactivate users and archive components rather than deleting records referenced by history. Stock and audit records are append-only for ordinary users. Session storage is deliberately not implemented in this milestone; when authentication is implemented, use a PostgreSQL-compatible server-side session store.

## Future stock transaction and concurrency design

No stock mutation endpoint is implemented now. Future stock operations must use a TypeORM transaction and:

1. Lock the target component row (`pessimistic_write`) or issue a conditional update that verifies the expected previous quantity.
2. Reject a resulting quantity below zero or any stale/conflicting update.
3. Update the component quantity and insert the corresponding transaction record in the same transaction.
4. Commit both records together; roll both back if either operation fails.

This design prevents concurrent requests from silently overwriting one another and keeps each quantity change attributable and auditable.

## API milestones and compatibility

### Migration milestone

- `GET /api/health` executes a PostgreSQL connectivity check and reports only connected/unavailable state.
- `GET /api/components` and trailing-slash equivalent return `{ "components": [] }` when no active components exist.
- `GET /api/components/:id` returns a public component or a safe 404; malformed UUIDs are rejected with 400 before querying.
- No auth, user-management, stock modification, or audit endpoints are exposed.

### Authentication and inventory milestones

The existing functional requirements for unauthenticated LAN dashboard access, Engineer/Admin roles, password handling, sessions, CSRF, rate limiting, protected transaction history, and Admin-only operations remain unchanged. Those features are deferred until after this database migration. Later authentication must use a PostgreSQL-compatible server-side session store and must preserve public browsing without creating a session. Authentication/API contracts, account recovery, audit coverage, and other open decisions remain governed by [requirements.md](./requirements.md).

## Open product decisions

Do not invent initial component names, photos, quantities, or minimum levels. Flexible attribute validation/search behavior, adjustment representation, photo storage, low-stock equality behavior, account recovery, LAN TLS, and audit retention/export remain to be agreed as listed in [requirements.md](./requirements.md#decisions-still-to-make).
