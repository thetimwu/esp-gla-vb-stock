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
Browser on authorised company LAN
        |
        | public read-only dashboard; login only for protected actions
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

The dashboard is available to every visitor on the authorised company LAN without login. Browsers never connect to PostgreSQL directly. Public dashboard GET endpoints are read-only and do not create a session. Stock writes and transaction-history reads require an authenticated active account; component/user management, audit-log, and settings operations require ADMIN. The backend is the authority for validation, authentication, authorization, business rules, and persistence. React may hide unavailable controls for a clear UX but cannot grant or enforce permission. PostgreSQL is on the internal Docker network and is not exposed to the LAN. The Compose development port binding is localhost-only.

## Access-control design

| Capability                                                           |  Anonymous LAN visitor | ENGINEER | ADMIN |
| -------------------------------------------------------------------- | ---------------------: | -------: | ----: |
| Dashboard, public component details, search/filter, stock statistics |                  Allow |    Allow | Allow |
| Stock-in, stock-out, authorised adjustment                           | Deny; prompt for login |    Allow | Allow |
| Stock transaction history                                            | Deny; prompt for login |    Allow | Allow |
| Create/edit/archive component definitions, photos, minimum levels    |                   Deny |     Deny | Allow |
| Create/edit/deactivate/reactivate users and assign roles             |                   Deny |     Deny | Allow |
| Audit logs and application inventory settings                        |                   Deny |     Deny | Allow |

Every protected request checks authentication and active-account state on the backend. ADMIN-only endpoints additionally check the role in backend middleware/service authorization. A frontend login redirect preserves the intended protected URL/action, then resumes it after successful login if still valid. No dashboard route or public GET redirects to login.

The public component response is an explicit allowlist: component ID, display name, description, current quantity, minimum stock level, and photo URL/reference. It excludes flexible/private attributes, user data, transaction and audit records, sessions, credentials, and security configuration. Total stock statistics and low-stock component counts can be derived from this public component collection; do not broaden public access to protected data to compute them. A component is low-stock when current quantity is strictly less than its minimum.

## Backend responsibilities

Keep HTTP routing, request validation, business rules, authorization, persistence, and response/error mapping distinct. Routes/controllers must not bypass business rules by writing directly to repositories.

- Keep `GET /api/health`, `GET /api/components`, and `GET /api/components/:id` public and read-only. Add public statistics only from the same public inventory data boundary.
- Public component responses include only component UUID, name as `displayName`, description, current quantity, minimum stock level, and photo reference. They do not expose JSONB attributes, credentials, sessions, users, transactions, or audit data.
- Validate UUID route parameters before querying PostgreSQL and return safe errors without exposing database internals.
- Require authentication and an active account for every stock write and transaction-history read. Require ADMIN for user administration, component administration, archiving, application settings, and audit-log access.
- Keep stock changes as domain operations: validate input, verify authorization, lock or conditionally update the component, and append its transaction atomically in one PostgreSQL transaction.
- Keep transaction and audit history append-only through ordinary application workflows. Deactivate users and archive components instead of deleting historical references.
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

## Implementation plan and API milestones

### Migration milestone

- `GET /api/health` executes a PostgreSQL connectivity check and reports only connected/unavailable state.
- `GET /api/components` and trailing-slash equivalent return `{ "components": [] }` when no active components exist.
- `GET /api/components/:id` returns a public component or a safe 404; malformed UUIDs are rejected with 400 before querying.
- Public list/detail responses contain the allowlisted component description as well as current stock, minimum level, name, and photo reference. They remain session-free.
- No auth, user-management, stock modification, or audit endpoints are exposed.

### 1. Public dashboard milestone

- Build the React dashboard against the public component endpoints without a login gate.
- Present inventory search/filter, descriptions/photos, total quantity statistics, low-stock count and below-minimum components. Derive statistics only from public inventory responses.
- Use semantic, accessible controls and keep public browsing session-free.
- Test anonymous list/detail reads, public response allowlisting, statistics/low-stock calculations, and absence of login redirects.

### 2. Authentication and protected-action milestone

- Implement login/logout and identity/session handling with protected sessions, login rate limiting, safe errors, and the selected CSRF defense for authenticated writes.
- Use a PostgreSQL-compatible server-side session store; public dashboard requests must not create sessions.
- Check authentication and active-account status in backend middleware for every protected read/write. Require a role check for ADMIN-only routes.
- Prompt/redirect to login only when an anonymous visitor attempts a protected action. Preserve and resume the intended action after login when safe and still authorized.
- Test login/session behavior, unauthorized access, deactivated accounts, and return-to-action behavior.

### 3. Stock operations and history milestone

- Add authenticated stock-in, stock-out, and agreed adjustment workflows for ENGINEER and ADMIN users.
- Add transaction-history reads for authenticated ENGINEER and ADMIN users.
- Persist each quantity change and transaction record atomically using the row-lock/conditional-update design above.
- Test engineer/admin stock permissions, validation, insufficient stock, concurrent updates, transaction atomicity, and anonymous history/write denial.

### 4. Administration milestone

- Add ADMIN-only component create/edit/archive, photo management, minimum-level management, user create/edit/role assignment/deactivation/reactivation, application settings, and audit-log reads.
- Ensure all admin route handlers enforce authorization in the backend, irrespective of React control visibility.
- Test that Engineers and anonymous visitors are denied each administrative capability and that Admin workflows preserve history.

The exact authentication/API contracts, adjustment representation, account recovery, photo storage, audit coverage, and other unresolved product/security decisions remain governed by [requirements.md](./requirements.md). Do not implement behavior depending on an unresolved decision until it is agreed.

## Open product decisions

Do not invent initial component names, photos, quantities, or minimum levels. Flexible attribute validation/search behavior, adjustment representation, photo storage, low-stock equality behavior, account recovery, LAN TLS, and audit retention/export remain to be agreed as listed in [requirements.md](./requirements.md#decisions-still-to-make).
