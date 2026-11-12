# Gate Components Inventory Management — Requirements

## Purpose and scope

The application will provide a private, LAN-accessible inventory system for gate components. The initial dashboard will show 10 components. Their names, photos, starting quantities, and minimum stock levels have not yet been supplied and must not be inferred.

The initial deployment has one central stock location. Multiple locations, external/public access, and public user registration are out of scope unless requirements change.

## Roles and access

### Unauthenticated LAN visitor

Anyone on the authorised internal company LAN may use the inventory dashboard without creating an account or starting a session. Unauthenticated visitors can:

- View the component dashboard, component photos, current quantities, and low-stock warnings.
- Search and filter components.
- View non-sensitive component details.

Public read access is limited to these component/inventory views. It must not expose passwords, session data, sensitive user information, stock transaction history, or administrative audit logs.

### Engineer

- Use the public component views above.
- Record stock-in, stock-out, and quantity-adjustment transactions.
- Add an optional comment to a transaction.
- View transaction history.

### Admin

An Admin can do everything an Engineer can do, and can also:

- Create, deactivate, and reactivate user accounts.
- Assign user roles.
- Create, edit, and archive component definitions.
- Manage component photos.
- Configure minimum stock levels and flexible component attributes.
- View administrative audit logs.

There is no public registration. Admins create accounts and set initial passwords. Authentication is required before any operation that changes data. Deactivation and component archiving preserve records needed for historical transactions; do not hard-delete users, components, stock transactions, or audit records through ordinary application workflows.

## Inventory rules

- Keep components, users, stock transactions, and administrative audit logs in separate MongoDB collections.
- Keep transaction history separate from component documents.
- Each successful stock change records the component, authenticated user, server timestamp, previous quantity, new quantity, change amount, action type, and optional comment.
- Save the resulting quantity change and its transaction record atomically in a MongoDB transaction.
- Use a MongoDB replica set, including a single-node replica set for a single-server installation.
- Prevent concurrent changes from silently overwriting one another. A conflicting/stale update must be rejected or safely retried; it must not be reported as successful unless both the quantity and transaction record are committed.
- Reject invalid quantities and any stock-out or adjustment that would result in a quantity below zero.
- Ordinary users must not be able to modify or delete existing transaction records.
- Show low-stock status by comparing current quantity with the configured minimum stock level. The exact equality/display behavior should be confirmed before UI implementation.
- Component definitions may include flexible attributes, but validation and supported attribute types need to be agreed before implementation.

### Transaction actions

- **Stock-in:** add a positive amount.
- **Stock-out:** remove a positive amount, provided sufficient stock remains.
- **Adjustment:** reconcile the recorded quantity to an explicitly supplied value or record a signed difference. The user experience and audit representation must be settled before implementation; in either design the resulting quantity cannot be negative.

Every transaction must be attributable to the authenticated user and use a server-generated timestamp. Client-supplied identity or timestamps must not be trusted.

## Security and operational requirements

- Enforce authentication and role-based authorization in Express middleware on the backend, not only in the React frontend.
- Public component GET endpoints are read-only and return only public component/inventory data. All write endpoints reject unauthenticated requests; Admin-only endpoints reject non-Admin users.
- Public GET endpoints must not expose passwords, session data, sensitive user information, stock transaction history, or administrative audit logs.
- Authentication is not required to browse the public dashboard. Public browsing must not require account creation or start a session. Require authentication for stock transaction history and all data-changing operations.
- Hash passwords with a suitable password-hashing algorithm. Never store or log plaintext passwords.
- Protect authenticated sessions; use login rate limiting, safe error responses, and appropriate CSRF protection for authenticated state-changing requests.
- Restrict access to the internal company LAN. Do not expose MongoDB to client devices.
- Keep secrets out of Git. Provide an `.env.example` containing placeholders only; real `.env` files and credentials must remain untracked and protected.
- Validate all client input on the server and avoid returning internal errors, credentials, or database details to clients.
- Keep stock transactions and administrative audit history protected against unauthorised modification or deletion.

## Acceptance criteria

1. The dashboard can present 10 initial component records without assuming their names, photos, quantities, or thresholds.
2. Any visitor on the authorised internal LAN can browse, search, and filter current component stock, photos, low-stock warnings, and non-sensitive details without an account or session.
3. Anonymous component GET endpoints are read-only and disclose no transaction history, administrative audit logs, session data, passwords, or sensitive user data.
4. Engineers can submit stock-in, stock-out, and adjustment actions with optional comments and view transaction history after authentication.
5. All write endpoints reject unauthenticated requests, and Admin-only operations are denied by the backend to non-Admin users.
6. A successful stock operation atomically updates the current quantity and appends the required transaction record.
7. Invalid input, insufficient stock, and concurrent conflicting changes cannot produce negative stock or an unrecorded quantity change.
8. Users and components needed by history can be deactivated or archived without erasing their historical references.
9. The service is configured for MongoDB replica-set transactions and is accessible only through the intended LAN deployment.

## Decisions still to make

- Names, photos, starting quantities, and minimum stock levels for the initial 10 components.
- Whether quantities are whole numbers or allow fractional precision, and the units/rounding rules.
- The exact adjustment workflow and representation.
- Whether a quantity exactly equal to the minimum is considered low stock.
- Supported flexible attribute types, validation rules, and whether attributes are searchable/filterable.
- Account recovery/reset process.
- TLS termination, reverse-proxy identity/trust configuration, and LAN certificate operations.
- Audit-log event coverage, retention, and any export requirements.
- Expected user count, availability expectations, and transaction conflict retry behavior.
- Photo file formats, size limits, storage location, and backup strategy.
- LAN hostname/IP, application port, TLS/certificate arrangement, and network/firewall ownership.
- Backup frequency, retention, recovery objectives, and the exact backup/restore tooling.
- Development and production environment variable names and application configuration defaults.
