# Gate Components Inventory Management — Architecture

## Agreed technology

- **Frontend:** React, TypeScript, and Vite. The public read-only dashboard, login/session navigation, stock operations, and protected transaction history are implemented in Milestones 3A–3E.
- **Backend:** Node.js, Express.js, and TypeScript.
- **Database:** PostgreSQL 17 with TypeORM and explicit migrations.
- **Deployment:** Docker and Docker Compose.
- **Initial host:** Windows PC on the internal company LAN, using Docker Desktop.
- **Future target:** Ubuntu Server.

The backend includes public inventory reads, session-based authentication, access control, component/user administration, protected history reads, and atomic stock operations. The React frontend provides the public read-only dashboard, sign-in/session navigation, stock operations, and a protected paginated transaction-history page; administration screens remain unimplemented.

## System boundaries

```text
Browser on authorised company LAN
        |
        | public inventory GETs; authentication endpoints use the server session
        v
React + TypeScript + Vite frontend
        |
        | same-origin /api proxy; public reads omit cookies, auth calls include them
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

Every protected request checks authentication and active-account state on the backend. ADMIN-only endpoints additionally check the role in backend middleware/service authorization. The frontend opens login when a visitor chooses Login or attempts a protected stock operation or transaction-history view. It preserves the intended protected destination through sign-in where still valid. No dashboard route or public GET redirects to login.

The public component response is an explicit allowlist: component ID, display name, description, part number, current quantity, minimum stock level, and photo URL/reference. It excludes flexible/private attributes, user data, transaction and audit records, sessions, credentials, and security configuration. `/api/statistics` returns public aggregate counts from active components only. A component is low-stock when current quantity is strictly less than its minimum.

The frontend uses `VITE_API_BASE_URL` (default `/api`) and the Vite server proxies that path to `API_PROXY_TARGET`. The proxy target is server-side configuration and is not exposed to browser code. Public inventory requests use `credentials: omit`; authentication and transaction-history requests use `credentials: include`. On startup, the frontend checks `GET /api/auth/session` to restore a signed-in account; the backend's `saveUninitialized: false` session configuration avoids creating an anonymous session. A CSRF token is requested when the visitor opens the login page, and after session restoration for an authenticated account. The frontend keeps the CSRF token and account state in memory only; it does not persist passwords, session IDs, or tokens in browser storage. The role-aware header shows an Administration item to ADMIN users only, but administration screens and controls are not implemented. User-management screens remain out of scope.

Authentication uses an HttpOnly, SameSite=Strict session cookie backed by the PostgreSQL `sessions` table. Session IDs rotate on login; each protected request reloads the account and checks that it remains active and has the required role. Login and authenticated state-changing requests require a synchronizer CSRF token. Login attempts are rate-limited per client IP. No session middleware is applied to public dashboard endpoints.

## Backend responsibilities

Keep HTTP routing, request validation, business rules, authorization, persistence, and response/error mapping distinct. Routes/controllers must not bypass business rules by writing directly to repositories.

- Keep `GET /api/health`, `GET /api/components`, `GET /api/components/:id`, and `GET /api/statistics` public and read-only.
- Public component responses include only component UUID, name as `displayName`, description, part number, current quantity, minimum stock level, and photo reference. They do not expose JSONB attributes, credentials, sessions, users, transactions, or audit data.
- Validate UUID route parameters before querying PostgreSQL and return safe errors without exposing database internals.
- Require authentication and an active account for stock writes and transaction-history reads. Require ADMIN for user administration, component administration, archiving, and audit-log access. No inventory settings endpoint is implemented.
- Keep stock changes as domain operations: validate input, verify authorization and active component/user state, lock the component row, and append its transaction atomically in one PostgreSQL transaction.
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
- Historical component-name and username snapshots, unaffected by later renames.
- Action enum: `STOCK_IN`, `STOCK_OUT`, or `ADJUSTMENT`.
- Previous quantity, new quantity, and quantity change are integers.
- Database checks require non-negative previous/new values, `quantity_change = new_quantity - previous_quantity`, action direction consistency, non-empty snapshots, and comments no longer than 500 characters.
- Optional comment (up to 500 characters) and server-generated creation timestamp.
- Component/time, user/time, action/time, and time indexes.

### `audit_logs`

- UUID primary key, nullable user foreign key (`SET NULL` on user deletion), action, entity type, and UUID entity ID.
- JSONB details and server-generated creation timestamp.
- Entity/time and user/time indexes.

### `sessions`

- Session ID primary key, serialized session JSON, and expiry timestamp with an expiry index.
- Accessed only by `connect-pg-simple`; public dashboard routes do not initialize sessions.

Ordinary application workflows must deactivate users and archive components rather than deleting records referenced by history. Stock and audit records are append-only for ordinary users. The API does not auto-create the session table or run migrations at startup. An initial or recovery ADMIN is created explicitly using the interactive `admin:create` CLI after migrations have run. It refuses to create another bootstrap administrator while any active ADMIN exists.

## Stock transaction and concurrency design

`POST /api/components/:componentId/stock-transactions` is available to authenticated active ENGINEER and ADMIN users. It requires the existing CSRF token and accepts one of:

- `{ "type": "STOCK_IN", "quantity": 5, "comment": "optional" }`
- `{ "type": "STOCK_OUT", "quantity": 3, "comment": "optional" }`
- `{ "type": "ADJUSTMENT", "newQuantity": 8, "comment": "optional" }`

Stock-in/out quantities must be positive whole numbers; adjustments set an absolute non-negative quantity. Values are bounded by PostgreSQL's signed integer maximum, and comments are trimmed and capped at 500 characters. The user identity and timestamp come from the server. Component-management routes do not accept quantity changes.

The service uses a TypeORM transaction and:

1. Lock the target component row using PostgreSQL `pessimistic_write`.
2. Reject a resulting quantity below zero or any stale/conflicting update.
3. Recheck that the component is active and the authenticated user remains active.
4. Update the component quantity and insert the corresponding transaction record with component/user name snapshots in the same transaction.
5. Commit both records together; roll both back if either operation fails.

This design prevents concurrent requests from silently overwriting one another and keeps each quantity change attributable and auditable.

`GET /api/transactions` is available to authenticated active ENGINEER and ADMIN users. It supports `limit` (1–100), `offset` (0–100000), and optional `componentId` (UUID), `actionType` (`STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`), `from`, and `to` ISO timestamps. Date bounds are inclusive and `from` cannot be later than `to`.

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

### Milestone 3A: public stock dashboard

- Implement the public React/TypeScript/Vite dashboard as the default frontend page; dashboard loading never requires login or redirects visitors.
- Load `GET /api/components` and `GET /api/statistics` in parallel and fetch `GET /api/components/:id` when opening a component detail view. Use the existing response envelopes and public fields, including optional part number; do not request protected endpoints.
- Provide summary cards, public component cards/details, name/part-number search, stock-status filtering, quantity/name sorting, loading/error/retry, and empty-inventory states.
- Keep API URL configuration in frontend environment variables. Use a same-origin `/api` Vite proxy for development; do not put credentials in frontend configuration.
- Do not add login, stock mutation, transaction, user-management, or administration functionality in this milestone.

### Milestone 3B: frontend login and session navigation

- Add a responsive login page that is entered only when a visitor chooses Login; public dashboard navigation and component details remain available without signing in.
- Use the existing `GET /api/auth/session`, `GET /api/auth/csrf-token`, `POST /api/auth/login`, and `POST /api/auth/logout` endpoints and their existing response formats.
- Restore the current server-managed session on application load. Use `credentials: include` for auth requests and retain public inventory requests as credential-free reads.
- Send the CSRF token in `x-csrf-token` for login and logout. Keep the token and authentication state in memory; do not persist passwords, session IDs, or tokens in browser storage.
- Show account identity and role-aware navigation. Only ADMIN users see the Administration navigation item; it is a placeholder until management screens are implemented, and backend authorization remains authoritative.
- Handle invalid credentials, CSRF failures, expired sessions, and logout without redirecting anonymous dashboard visitors to login.
- Do not add public registration, stock operations, user-management screens, or administration screens.

### Milestone 3C: backend stock operations and transaction history

- Implement authenticated stock-in, stock-out, and absolute-quantity adjustments for ENGINEER and ADMIN users.
- Persist each quantity change and snapshot-bearing transaction record atomically using a PostgreSQL row lock.
- Extend protected transaction history with component, action, and inclusive date-range filters.
- Keep component-management writes independent of stock quantity.
- Verify validation, permissions, insufficient stock, concurrent updates, transaction atomicity, and anonymous history/write denial using PostgreSQL integration tests.

### Milestone 3D: React stock operations interface

- Allow authenticated ENGINEER and ADMIN users to submit stock-in, stock-out, and adjustment operations through the existing protected endpoint.
- Preserve public read-only access and prompt anonymous visitors to sign in only when they request a protected stock action.
- Refresh public component and statistics data after a successful operation; keep the server authoritative for stock quantities.

### Milestone 3E: stock transaction history interface

- Provide a protected history view to authenticated ENGINEER and ADMIN users; anonymous attempts return to sign-in and return to history after successful authentication.
- Use `GET /api/transactions` with server-side component, action, inclusive date-range, and pagination parameters; display historical component/user snapshots and quantity changes.
- Keep transaction records out of public dashboard responses and handle loading, empty, retry, and expired-session states.

Authentication/API contracts, account recovery, photo storage, audit coverage, and other unresolved product/security decisions remain governed by [requirements.md](./requirements.md). Do not implement behavior depending on an unresolved decision until it is agreed.

## Open product decisions

Do not invent initial component names, photos, quantities, or minimum levels. Flexible attribute validation/search behavior, photo storage, account recovery, LAN TLS/proxy configuration, and audit retention/export remain to be agreed as listed in [requirements.md](./requirements.md#decisions-still-to-make).
