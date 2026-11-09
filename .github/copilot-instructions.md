# Copilot instructions

- Follow [the requirements](../docs/requirements.md), [architecture](../docs/architecture.md), and [deployment plan](../docs/deployment.md). Do not introduce a different stack or bypass the documented frontend/backend/database boundaries.
- Use strict TypeScript and explicit types at API and domain boundaries. Prefer small, cohesive modules; keep HTTP handling, validation, business rules, persistence, and UI responsibilities separate.
- Validate and normalize all untrusted input on the server. Enforce authentication, active-account checks, and role authorization in Express middleware/backend services; frontend checks are only for presentation. Public component GETs are read-only and require no account or session; exclude transaction history, audit logs, session data, credentials, and sensitive user information from public responses. Require authentication on every write and protected read, and Admin role on admin-only endpoints.
- Treat stock changes as domain operations. Never update quantity without atomically writing the corresponding transaction in a MongoDB replica-set transaction. Prevent stale concurrent writes and negative quantities. Keep transaction history append-only for ordinary users.
- Store passwords only as secure hashes. Protect authenticated sessions, rate-limit login, apply the selected CSRF defenses to authenticated writes, keep MongoDB private, and never commit or log secrets.
- Return safe, consistent errors; do not swallow exceptions or expose stack traces, credentials, or database internals. Make validation, authorization, and conflict failures clear to the user.
- Test business rules and failure cases, especially role boundaries, validation, insufficient stock, concurrent updates, and transaction atomicity. Run the smallest relevant test set, plus type-check/lint/build checks available for touched code.
- Build accessible interfaces with semantic HTML, labels, keyboard support, visible focus, clear validation feedback, and adequate contrast.
- Preserve historical records: deactivate users and archive components instead of deleting records required by transaction or audit history.
- Do not invent initial component names, stock levels, or unresolved product/security decisions. Ask or document the decision before implementing behavior that depends on one.
