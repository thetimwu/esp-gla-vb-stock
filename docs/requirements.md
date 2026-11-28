# Gate Components Inventory Management — Requirements

## Purpose and scope

The application will provide an inventory system for gate components, available to everyone on the authorised company LAN. The main dashboard is public and read-only; authentication is requested only when a visitor attempts a protected operation. The initial dashboard will show 10 components. Their names, photos, starting quantities, and minimum stock levels have not yet been supplied and must not be inferred.

The initial deployment has one central stock location. Multiple locations, external/public access, and public user registration are out of scope unless requirements change.

## Roles and access

### Unauthenticated visitor on the authorised company LAN

No account or session is required to open the website or browse the dashboard. Unauthenticated visitors can:

- View all active components, photos, names, descriptions, current quantities, and other non-sensitive component details.
- View total stock statistics and counts of low-stock components.
- Identify components below their minimum stock levels.
- Search by component name or part number and filter the inventory by stock status.
- View non-sensitive component details.

Part numbers are non-sensitive component details and may be included in the public component response when present. Public reads must not expose user information, passwords or password hashes, session data, internal security settings, private audit logs, transaction history, or sensitive administrative information. Low stock means current quantity is strictly below the configured minimum.

### Engineer

- Do everything an unauthenticated visitor can do.
- Perform stock-in, stock-out, and authorised stock-adjustment operations.
- Add an optional comment to a stock transaction.
- View stock transaction history.
- Cannot create or manage users, assign roles, create/edit/archive component definitions, change minimum stock levels, or change application settings.

### Admin

An Admin has full control over inventory and user management. Admins can do everything an Engineer can do, and can also:

- Add components; edit component names, descriptions, and details; upload or change photos; set minimum stock levels; and archive components.
- Create and edit user accounts; assign ENGINEER or ADMIN roles; deactivate and reactivate users.
- Manage application inventory settings.
- View all stock transaction history and administrative audit logs.

There is no public registration. Admins create accounts and set initial passwords. Deactivation and component archiving preserve records needed for historical transactions; do not hard-delete users, components, stock transactions, or audit records through ordinary application workflows.

### Authentication prompts

Only prompt for login when an unauthenticated visitor attempts an operation requiring authentication, such as updating stock, viewing transaction history, or opening administration functions. A protected-action request must be rejected by the backend when unauthenticated. The frontend should send the visitor to login and, after successful authentication, return them to the intended action where it remains valid. Opening the dashboard or viewing public statistics must never redirect to login.

## Inventory rules

- Keep components, users, stock transactions, and administrative audit logs in separate PostgreSQL tables.
- Use PostgreSQL 17 with TypeORM and explicit migrations. Disable schema synchronization in normal development and production; do not apply migrations implicitly on application startup.
- Keep transaction history separate from component documents.
- Each successful stock change records the component, authenticated user, server timestamp, previous quantity, new quantity, change amount, action type, and optional comment.
- Save the resulting quantity change and its transaction record atomically in a PostgreSQL transaction.
- Lock the component row or use a conditional update to reject stale concurrent writes; roll back the quantity and transaction together if either fails.
- Prevent concurrent changes from silently overwriting one another. A conflicting/stale update must be rejected or safely retried; it must not be reported as successful unless both the quantity and transaction record are committed.
- Use integer quantities initially. Reject invalid quantities and any stock-out or adjustment that would result in a quantity below zero at both application and database boundaries.
- Ordinary users must not be able to modify or delete existing transaction records.
- Show low-stock status when current quantity is strictly less than the configured minimum stock level.
- Component definitions may include flexible attributes, but validation and supported attribute types need to be agreed before implementation.

### Transaction actions

- **Stock-in:** add a positive amount.
- **Stock-out:** remove a positive amount, provided sufficient stock remains.
- **Adjustment:** reconcile the recorded quantity to an explicitly supplied value or record a signed difference. The user experience and audit representation must be settled before implementation; in either design the resulting quantity cannot be negative.

Every transaction must be attributable to the authenticated user and use a server-generated timestamp. Client-supplied identity or timestamps must not be trusted.

## Security and operational requirements

- Enforce authentication, active-account checks, and role-based authorization on every applicable backend route/service; hiding React controls is presentation only and never authorization.
- Public component/inventory GET endpoints are read-only, session-free, and return only public component/inventory data. No authentication is required for dashboard reads.
- All stock-changing endpoints and transaction-history reads require an authenticated active account. Component management, user management, audit-log, and settings endpoints require ADMIN.
- Never include credentials, user/session data, internal security settings, audit logs, transaction history, or sensitive administrative information in public responses.
- Hash passwords with a suitable password-hashing algorithm. Never store or log plaintext passwords.
- Protect authenticated sessions; use login rate limiting, safe error responses, and appropriate CSRF protection for authenticated state-changing requests.
- Restrict access to the internal company LAN. Keep PostgreSQL on the private application network and do not expose it to client devices or the company LAN.
- Keep secrets out of Git. Provide an `.env.example` containing placeholders only; real `.env` files and credentials must remain untracked and protected.
- Validate all client input on the server and avoid returning internal errors, credentials, or database details to clients.
- Keep stock transactions and administrative audit history protected against unauthorised modification or deletion.
- Restore a signed-in account from the existing session endpoint without redirecting public visitors. Use the existing CSRF mechanism for login and logout; keep passwords, session IDs, and CSRF tokens out of persistent browser storage.

## Acceptance criteria

1. The dashboard can present 10 initial component records without assuming their names, photos, quantities, or thresholds.
2. Any visitor on the authorised internal LAN can open the dashboard and view/search/filter active components, photos, names, descriptions, current quantities, total stock statistics, low-stock counts, below-minimum components, and non-sensitive details without an account or session.
3. Anonymous public GETs succeed and remain read-only; they disclose no user data, passwords/hashes, session data, internal security settings, transaction history, audit logs, or sensitive administrative information.
4. An unauthenticated attempt to update stock or access transaction history/admin functions prompts login; after login the visitor returns to the intended valid action where appropriate. Public dashboard navigation never prompts for login.
5. Engineers can perform stock-in, stock-out, and authorised adjustments and view history; the backend rejects their attempts to manage components, users, roles, or settings.
6. Admins can manage inventory and users, assign only ENGINEER/ADMIN roles, view transaction history and audit logs, and manage inventory settings.
7. Every protected operation rejects unauthenticated and deactivated accounts; Admin-only operations reject Engineers, regardless of frontend visibility.
8. A successful stock operation atomically updates the current quantity and appends the required transaction record.
9. Invalid input, insufficient stock, and concurrent conflicting changes cannot produce negative stock or an unrecorded quantity change.
10. Users and components needed by history can be deactivated or archived without erasing their historical references.
11. The service uses PostgreSQL transactions and is accessible only through the intended LAN deployment.
12. The frontend offers login only by explicit user choice, restores an existing session, shows account/role navigation, and preserves public dashboard access for anonymous visitors.

### Authorization and regression test matrix

Add backend/API tests for each item below as its route/service is implemented; frontend visibility is not a substitute for these backend tests:

- Anonymous dashboard, component-list, statistics, and component-detail reads succeed without setting a session cookie; responses contain public descriptions and omit private fields.
- Anonymous stock writes are rejected and do not change quantity; anonymous transaction-history reads are rejected.
- An ENGINEER can perform permitted stock operations and read history, but is denied component/user management.
- An ADMIN can create/edit/archive components, manage/reactivate/deactivate users and roles, adjust inventory settings, and read transactions/audit logs.
- Deactivated accounts are denied all protected operations; denied/invalid stock operations do not change quantity or create misleading transaction records.
- Stock update and transaction insertion are atomic, and concurrent updates preserve the stock invariants.

## Decisions still to make

- Names, photos, starting quantities, and minimum stock levels for the initial 10 components.
- Units and rounding rules for integer quantities, and whether fractional precision may be needed in a future schema change.
- The exact adjustment workflow and representation.
- Supported flexible attribute types, validation rules, and whether attributes are searchable/filterable.
- Account recovery/reset process.
- TLS termination, reverse-proxy identity/trust configuration, and LAN certificate operations.
- Audit-log event coverage, retention, and any export requirements.
- Expected user count, availability expectations, and transaction conflict retry behavior.
- Photo file formats, size limits, storage location, and backup strategy.
- LAN hostname/IP, application port, TLS/certificate arrangement, and network/firewall ownership.
- Backup frequency, retention, recovery objectives, and the exact backup/restore tooling.
- Development and production environment variable names and application configuration defaults.
