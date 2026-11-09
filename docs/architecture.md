# Gate Components Inventory Management — Architecture

## Agreed technology

- **Frontend:** React, TypeScript, and Vite.
- **Backend:** Node.js, Express.js, and TypeScript.
- **Database:** MongoDB with Mongoose.
- **Deployment:** Docker and Docker Compose.
- **Initial host:** Windows PC on the internal company LAN, using Docker Desktop.
- **Future target:** Ubuntu Server.

This document defines the intended boundaries and data responsibilities, not a finalized API contract or implementation.

## System boundaries

```text
Browser on company LAN
        |
        | HTTP(S), public read API and authenticated operations
        v
React + TypeScript frontend
        |
        | public component GETs; authenticated requests for protected data/writes
        v
Express + TypeScript backend
        |
        | Mongoose; replica-set transactions
        v
MongoDB replica set (single node initially)
```

Browsers must never connect to MongoDB directly. Anyone on the authorised internal company LAN may use public, read-only component endpoints without an account or session. Authentication is required for every write and for protected reads such as transaction history; Admin authorization is required for administrative operations. The backend is the sole authority for authentication, authorization, validation, inventory mutations, audit writes, and database access. Docker networking should keep MongoDB on an internal container network and should not publish its port to the LAN.

## Frontend responsibilities

- Render the public component dashboard, search/filter controls, low-stock indicators, photos, and non-sensitive details without requiring login.
- Render transaction forms/history and administrative screens only for the corresponding authenticated roles; these client-side gates are a usability aid, not authorization.
- Send public component GET requests without requiring a session; send authenticated requests for transaction history and writes, and present validation/conflict errors clearly.
- Avoid keeping authentication secrets in browser-accessible persistent storage. The final session mechanism, storage, and cookie settings are open decisions.
- Meet accessibility requirements: semantic structure, keyboard operation, visible focus, labels and useful validation/error announcements, and adequate contrast.

## Backend responsibilities

Organize the backend so that HTTP routing, request validation, business rules, authorization, persistence, and response/error mapping are distinct responsibilities. Routes/controllers should not bypass business rules by writing directly to Mongoose models.

Express middleware must enforce authentication and role-based authorization on the backend; application services must also preserve domain invariants. React visibility checks do not substitute for backend enforcement:

- Allow unauthenticated, read-only component GET endpoints for public fields only, including dashboard data, photos, current quantity, low-stock status, search/filter, and non-sensitive details.
- Require authentication and an active account for all write endpoints and protected reads, including transaction history.
- Require the Admin role for user administration, component definition/photo/minimum-stock/attribute management, archiving, and audit-log reads. Reject non-Admin requests.
- Never include passwords, session data, sensitive user information, stock transaction history, or administrative audit logs in public GET responses.
- Validate and normalize all request data on the server.
- Apply stock rules and perform each stock change plus transaction insert in a MongoDB transaction.
- Use concurrency-safe conditional updates (for example, matching the expected current quantity/version) so stale writes cannot silently succeed. A transaction conflict must be surfaced or retried safely.
- Generate authoritative timestamps on the server.
- Append administrative audit entries for administrative changes; audit coverage must be finalized.
- Return safe, consistent errors without exposing stack traces, secrets, or database internals.
- Apply login rate limiting and the selected CSRF protections.
- Keep transaction and audit history protected against unauthorized modification or deletion.

## Initial Mongoose schema decisions

The first backend milestone defines collection schemas but does not seed data or expose write operations. These are minimal implementation choices for the documented logical models, not a final business schema:

- **Components:** `displayName`, non-negative numeric `currentQuantity`, non-negative numeric `minimumStockLevel`, optional `photoUrl`, optional flexible `attributes`, and `isArchived`, plus Mongoose timestamps. Public reads project only `_id`, display name, quantity, minimum level, and photo URL; they do not return attributes or persistence-only fields.
- **Users:** `username`, `passwordHash` (excluded from ordinary Mongoose selection), `role` (`Engineer` or `Admin`), and `isActive`, plus timestamps. No user is seeded. A username is used as the initial account identifier pending confirmation.
- **Stock transactions:** references to component and user, server-defaulted timestamp, previous/new quantities, signed change amount, action type, and optional comment. Stored separately in an append-oriented collection.
- **Audit logs:** actor reference, action, target type (`user` or `component`), target ID, and timestamp in a separate collection. No audit API is exposed in this milestone.

Amounts use JavaScript/MongoDB numeric values with a minimum constraint but no integer-only restriction, because quantity precision and units remain undecided. `photoUrl` is only a placeholder for a photo reference; photo hosting and validation are not implemented. Flexible attributes are not returned publicly until their allowed/public fields are defined. No initial components, users, or credentials are seeded.

## Data model responsibilities

The following are logical collections and minimum responsibilities, not a final schema.

### Components

One document per component definition, including a stable identifier, display name, current quantity, minimum stock level, active/archived state, photo reference/metadata, flexible attributes, and timestamps. Do not embed unbounded transaction history here. Initial component records and values are not yet defined.

### Users

One document per user, including a stable identifier, account identity, password hash, role (`Engineer` or `Admin`), active/deactivated state, and relevant timestamps. Historical transaction references must remain meaningful after deactivation. Password reset and account recovery details are undecided.

### Stock transactions

Append-only records in their own collection. Each successful transaction records at least:

- Component reference.
- Authenticated user reference.
- Server-generated timestamp.
- Previous and new quantity.
- Change amount.
- Action type (stock-in, stock-out, or adjustment).
- Optional comment.

Do not expose ordinary-user APIs for editing or deleting these records. A stock operation must commit the component quantity change and transaction insert together in one MongoDB transaction. Transaction support requires a replica set, including the planned single-node initial deployment.

### Administrative audit logs

Separate collection for records of administrative actions. At minimum, the design must retain enough information to identify the actor, action, target, and time. Exact event coverage, before/after data, retention, and export policy are decisions to settle before implementation. Audit records must not be editable through ordinary application workflows.

## API boundaries

The API is a private application interface between the browser and Express; the exact route names, versioning, payloads, and response schemas remain to be designed. It should provide distinct resource/action boundaries for:

- Authentication and session lifecycle.
- Public, unauthenticated, read-only component listing/detail/search/filter endpoints, limited to non-sensitive fields and component photos.
- Authenticated stock-in, stock-out, and quantity-adjustment commands.
- Authenticated, read-only transaction history.
- Admin-only user lifecycle and role management.
- Admin-only component definition, photo, minimum-stock, attribute, and archive operations.
- Admin-only audit-log viewing.

Enforce authentication, active-account checks, and role checks in Express middleware for every protected operation. All write endpoints require authentication; Admin-only endpoints require an active Admin. Public component GETs must remain read-only and must not expose protected data. Do not rely on client-side role checks. Treat stock writes as commands rather than general-purpose component updates, so the stock invariant and transaction audit cannot be bypassed.

### Milestone 1 API

- `GET /api/health` reports API and current Mongoose connection state without connection details.
- `GET /api/components` and its trailing-slash equivalent return a `components` array, empty when none exist.
- `GET /api/components/:componentId` returns a public component or a safe 404; malformed ObjectId parameters are rejected with 400 before querying MongoDB.

The component endpoints require no account or session and use an explicit response projection. Search/filter behavior is not implemented yet.

## Security approach

- Use server-side password hashing with a vetted algorithm and parameters selected during implementation.
- Require no login, account, or session to browse public component GET endpoints. Avoid creating a session just to serve public dashboard data.
- Use protected sessions for authenticated functionality; choose secure cookie flags, session storage, and transport settings for the final LAN/TLS arrangement.
- Select and implement CSRF defenses compatible with the session/authentication design for authenticated state-changing requests.
- Rate-limit login attempts and avoid account-enumeration details in authentication errors.
- Validate request bodies, path values, and query parameters at the backend boundary.
- Exclude password hashes, session data, sensitive user information, transaction history, and administrative audit logs from public GET responses.
- Keep stock transaction and audit records protected from unauthorized modification and deletion.
- Use least-privilege database credentials and do not publish MongoDB ports to client networks.
- Keep secrets in deployment/local environment configuration, not source control. The checked-in `.env.example` contains placeholders only.
- Restrict network access to the internal LAN and configure host firewall rules accordingly.

## Unresolved design decisions

See [requirements.md](./requirements.md#decisions-still-to-make) for the full list. In particular, finalize quantity precision, adjustment semantics, authentication/session and CSRF mechanisms, API contracts, photo storage, flexible attribute validation, audit coverage, and LAN/TLS details before implementation.
