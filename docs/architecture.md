# Gate Components Inventory Management — Architecture

## Agreed technology

- **Frontend:** React, TypeScript, and Vite (planned).
- **Backend:** Node.js, Express.js, and TypeScript.
- **Database:** PostgreSQL 17 with TypeORM and explicit migrations.
- **Deployment:** Docker and Docker Compose.
- **Initial host:** Windows PC on the internal company LAN, using Docker Desktop.
- **Future target:** Ubuntu Server.

The backend includes public inventory reads, session-based authentication, access control, component/user administration, and protected history reads. The React frontend and stock mutation workflows remain unimplemented.

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

The public component response is an explicit allowlist: component ID, display name, description, current quantity, minimum stock level, and photo URL/reference. It excludes flexible/private attributes, user data, transaction and audit records, sessions, credentials, and security configuration. `/api/statistics` returns public aggregate counts from active components only. A component is low-stock when current quantity is strictly less than its minimum.

Authentication uses an HttpOnly, SameSite=Strict session cookie backed by the PostgreSQL `sessions` table. Session IDs rotate on login; each protected request reloads the account and checks that it remains active and has the required role. Login and authenticated state-changing requests require a synchronizer CSRF token. Login attempts are rate-limited per client IP. No session middleware is applied to public dashboard endpoints.

## Backend responsibilities

Keep HTTP routing, request validation, business rules, authorization, persistence, and response/error mapping distinct. Routes/controllers must not bypass business rules by writing directly to repositories.

- Keep `GET /api/health`, `GET /api/components`, `GET /api/components/:id`, and `GET /api/statistics` public and read-only.
- Public component responses include only component UUID, name as `displayName`, description, current quantity, minimum stock level, and photo reference. They do not expose JSONB attributes, credentials, sessions, users, transactions, or audit data.
- Validate UUID route parameters before querying PostgreSQL and return safe errors without exposing database internals.
- Require authentication and an active account for transaction-history reads. Require ADMIN for user administration, component administration, archiving, and audit-log access. No stock write or settings endpoints are implemented in this milestone.
- Keep stock changes as domain operations: validate input, verify authorization, lock or conditionally update the component, and append its transaction atomically in one PostgreSQL transaction.
- Keep transaction and audit history append-only through ordinary application workflows. Deactivate users and archive components instead of deleting historical references.
- Use explicit TypeORM migrations. `synchronize` and automatic migration-on-startup remain disabled.
- Keep secrets in environment configuration, not source control or logs.

## PostgreSQL entities and constraints

The inventory migration creates four tables; a separate TypeORM migration adds the PostgreSQL-backed `sessions` table. No users, components, stock transactions, audit logs, or initial quantities are seeded.

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

### `sessions`

- Session ID primary key, serialized session JSON, and expiry timestamp with an expiry index.
- Accessed only by `connect-pg-simple`; public dashboard routes do not initialize sessions.

Ordinary application workflows must deactivate users and archive components rather than deleting records referenced by history. Stock and audit records are append-only for ordinary users. The API does not auto-create the session table or run migrations at startup. An initial or recovery ADMIN is created explicitly using the interactive `admin:create` CLI after migrations have run. It refuses to create another bootstrap administrator while any active ADMIN exists.

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
- No stock modification endpoints are exposed.

### Milestone 2: public data, authentication, and permissions

- Public endpoints: `GET /api/components`, `GET /api/components/:id`, and `GET /api/statistics`; no session is created for these requests.
- Authentication endpoints: `GET /api/auth/csrf-token`, `POST /api/auth/login`, `GET /api/auth/session`, and `POST /api/auth/logout`.
- Protected history endpoints: `GET /api/transactions` for active ENGINEER/ADMIN users and `GET /api/admin/audit-logs` for ADMIN users.
- ADMIN component endpoints: `GET /api/admin/components`, `GET /api/admin/components/:id`, `POST /api/components`, and `PATCH /api/components/:id` for definitions, minimum levels, photo references, attributes, and archive state. Quantity is deliberately not accepted.
- ADMIN user endpoints: `GET/POST /api/admin/users` and `PATCH /api/admin/users/:userId`. Responses never include password hashes.
- All state-changing routes require a valid CSRF token. Role and active-account checks are backend middleware; deactivation takes effect on the next protected request.
- `POST /api/auth/login` is limited to 10 attempts per IP per 15-minute window.
- Do not add a React frontend or stock mutation endpoints as part of this milestone.

### Milestone 3: stock operations

- Add authenticated stock-in, stock-out, and agreed adjustment workflows for ENGINEER and ADMIN users.
- Persist each quantity change and transaction record atomically using the row-lock/conditional-update design above.
- Test engineer/admin stock permissions, validation, insufficient stock, concurrent updates, transaction atomicity, and anonymous history/write denial.

The exact authentication/API contracts, adjustment representation, account recovery, photo storage, audit coverage, and other unresolved product/security decisions remain governed by [requirements.md](./requirements.md). Do not implement behavior depending on an unresolved decision until it is agreed.

## Open product decisions

Do not invent initial component names, photos, quantities, or minimum levels. Flexible attribute validation/search behavior, adjustment representation, photo storage, account recovery, LAN TLS/proxy configuration, and audit retention/export remain to be agreed as listed in [requirements.md](./requirements.md#decisions-still-to-make).
