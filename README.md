# EMCore - Inventory

Mobile-first React / Vite application using Bootstrap 6.0.0-alpha.1, Lucide icons, and a local Node/SQLite API.

## Run

Requires Node.js 24.14+.

1. npm install
2. npm run dev
3. Open http://localhost:5173 (or the URL Vite prints).

SQLite is stored at server/data/inventory.sqlite and ignored by Git. The API binds to 127.0.0.1:3001. Vite proxies /api.

## Home and settings

Home has large square icon quick actions, including Drug Checks, Use Medication, Incidents, Create Batch / Receive Stock, Manage Par Levels, Medication Tags, Container / Storage Designer, Logs, Medication Classes, and Access Policies. Each interior page has a Back button next to its title. Navigation remembers the preceding page.

Manage Par Levels stores concentration, total labelled content per item, presentation, tags, par quantities per container, and a drug-type check interval. Identity fields lock once a profile has stock. Tags, pars, and schedules remain editable.

The designer creates and edits storage areas and containers, icons, types, transparency, seal state, seal number, and check intervals. Editing a seal requires confirmation that the previous physical seal was broken. Resealing enforces configured witness requirements and is recorded against the contents.

Both drug and container check intervals default to 24 hours, as requested. Zero means no schedule at that level. The shortest positive interval among a container and its drug profiles determines when the container is next due. A completed container check covers every item in that container. These are application settings, not a claim about a legally mandated schedule.

## Starter medications and migration

Existing item IDs, tracking codes, stock counts, and histories are preserved. The existing medications are linked to standardized definitions, with their old presentation retained in a standardization event. Par targets start from the existing starter quantities; they are not imported treatment recommendations.

Source: Maine EMS 2025 Formulary, V4, March 11, 2026:
https://www.maine.gov/ems/sites/maine.gov.ems/files/inline-files/2025-MEMS-Formulary-v4-Print-Version-20260311.pdf

The source is linked on seeded profile forms. Midazolam lists alternate supplied concentrations; this starter uses 5 mg/mL in a 1 mL vial and records that selection. Fentanyl uses 100 mcg/2 mL and ketamine 100 mg/mL in 5 mL. These are stocking defaults from the referenced formulary, not patient dose limits or confirmation of a physical vial label. Original requested container quantities are retained, including aspirin 324 mg packs and norepinephrine 8 mg in 250 mL premixed bags. The user's existing Dextrose 10%, 250 mL bag is also preserved and standardized.

The schema migrations run once where appropriate and do not duplicate stock on restart. A database backup was made before the workflow migration.

## Codes and receiving stock

Choose a standardized profile, batch quantity (1–1,000), a lot number, and one expiration date shared by the whole batch. New stock defaults to the Unassigned staging area with Unassigned status; use Transfer to assign individual items afterward. Each item retains its batch ID, lot, expiration, and unique tracking code. Existing stock has unknown lot/expiration where these were never recorded. Either generate codes or enter one eight-character alphanumeric code per item. Manual codes are normalized to uppercase. Duplicate batch codes and codes that have ever been issued are rejected before any stock or seal changes occur.

The tracking_codes registry is permanent and immutable. Used and disposed items retain their code and history. Public codes remain distinct from stable internal IDs. external_source / external_id fields reserve import provenance for future import tools.

## Drug checks

Containers start collapsed and only one opens at a time. Start a check, verify items, and Save draft to resume it later. Every verification is saved to SQLite immediately. Draft notes and progress survive reload and navigation.

Complete check requires every current item to be verified. Completed checks hide by default; Show completed checks brings them back with a checkmark. Reset check and Ad hoc check start a new session without deleting previous records. Check history lists saved, completed, and superseded sessions.

Stock changes invalidate an old completion or draft, including partial use and seal changes. Stale drafts must be reset. Revision checks prevent an older browser session from overwriting newer progress. The app refreshes status every minute while a workspace is open.

## Incidents and partial use

Select one or more items across storage areas. Search is scoped to the selected unit/cabinet and matches names, strengths, codes, and tags. For Used Medication, enter the amount given and wasted in the profile's medication unit. The server checks that their sum cannot exceed the vial balance. Unconsumed remainder stays as opened stock; exhausted items leave active inventory. Individual records show given, wasted, remaining, incident number, witness, and corrections.

Save draft persists an unfinished incident without changing stock or opening seals. Saved incidents are searchable and can be reopened. Completed incidents are read-only until explicitly reopened. A correction reason is required for resaving a reopened incident. The server applies only the difference from the incident's previous allocation, preserves all earlier versions, and prevents over-allocation if another incident has since used the vial. Reopening alone changes no stock. Older whole-item incident records are migrated to versioned allocations.

Optimistic revisions reject stale edits. A client key prevents a retry of new-incident creation from duplicating it. Browser-local editor state is a convenience; saved incident records and check sessions live in SQLite.

## Witnesses and seals

Medication tags configure witness requirements for entire-use, partial-use, disposal, opening, replacement, transfer, breaking seals, and resealing. Requirements are enforced by the API, including correction of previous allocations. A different active user in the same service must enter their own username/password for the specific save. Can Witness is mandatory (including for Service Admins), Read Only is disallowed, and the current global/medication witness policies also apply. The operator does not need Can Witness. A name, user ID, or copied signature cannot substitute for authentication.

Same-container moves are excluded by the picker and rejected by the API. Moving items into or out of a sealed container requires explicit physical seal-break confirmation. The same guard applies to receiving stock, recording physical use, and designer changes that break an existing seal. All mutations commit atomically.

## API

- GET /api/health
- GET /api/inventory: active stock, profiles, tags, pars, check states, saved incidents
- GET /api/history?item=CODE: individual vial history, including archived stock
- GET /api/incident?id=ID: incident payload, stock, allocations, and all versions
- GET /api/checks?boxId=ID: check history
- POST /api/drugs: definitionId, quantity, batchCreate=true, lotNumber, expirationDate (YYYY-MM-DD), codeMode, optional codes, replacement, witnessCredentials {username,password}. Missing boxId defaults to Unassigned. Legacy explicit destinations require transfer permission and normal seal checks.
- POST /api/move: itemId, sourceId, destinationId
- POST /api/incidents/draft: unfinished incident payload
- POST /api/incidents: complete/correct incident; existing records require id and revision
- POST /api/incidents/reopen: id, revision
- POST /api/checks/start: boxId, kind (scheduled/reset/adhoc)
- POST /api/checks/verify: boxId, revision, itemId, verified
- POST /api/checks/save or /api/checks/complete: boxId, revision, notes
- POST /api/containers: container configuration
- POST /api/definitions or /api/tags: catalog settings

Seal conflicts return HTTP 409 with sealedBoxes. Retry only after physical confirmation with brokenSeals [{id,seal}]. Witness violations return 422 with witnessRequired. Stale revisions and reused codes return 409. Settings changes and individual item changes are audited.

## Verify

- npm run build
- npm run lint
- node --test server/inventory.test.js server/features.test.js server/catalog.test.js server/workflows.test.js server/access.test.js server/auth.test.js server/witness-qr.test.js

Tests use isolated in-memory databases. Browser trials also use a separate in-memory instance, leaving the main inventory untouched by test receipts, incidents, and checks. Production migrations preserve the preexisting stock and codes.

Import UI remains a future feature. New witness signoffs use authenticated user accounts; old name-only entries are retained and labelled legacy.

## Shared fields and dropdowns

All editable text, numeric, date, search, and multiline fields have a clear X when nonempty. Locked/disabled fields do not expose mutation controls. Every select is a keyboard-accessible searchable combobox; typing filters choices, arrows move the active choice, Enter selects, and Escape closes the list. The storage icon selector immediately previews the selected icon.

## Classes and access policies

Drug definitions can be assigned a medication class. Classes can be created inline or managed from Medication Classes. They are organizational labels, not automatically generated clinical-scope rules.

The top-right dropdown selects among services the signed-in user belongs to. The adjacent name identifies the current user. Access Policies manages role templates and page/action rules; templates copy tags when creating/editing a user and do not silently change existing accounts. Per-medication rules still add restrictions. Clinician tags do not establish legal clinical scope.

## Accounts and services

On first launch, enter your service name and create the first Service Admin at http://localhost:5173. No default username/password is installed. Existing stock, histories and tracking codes remain in the primary service. Sign in on later visits.

Service Admins use Home → Users to create accounts, set/reset passwords, assign roles/capability tags, and activate/deactivate users in the active service. At least one active Service Admin must remain. Username uniqueness is application-wide. Roles and permissions are read from SQLite on every request, so changes take effect for existing sessions. Deactivation/password reset revokes all that user's sessions. My Account lets a user change their own password and revokes other sessions.

Passwords use salted scrypt hashes. Sessions use random opaque tokens, stored hashed in SQLite, with an eight-hour absolute lifetime; cookies are HttpOnly and SameSite=Strict. Passwords and session tokens are excluded from application audit details. Repeated failed logins are throttled for 15 minutes after five failures per remote-address/username combination. JSON writes reject foreign Origin headers. X-EMCore-Profile no longer selects identity or grants access.

Home → Services / DEA creates and edits services. A new service grants its creator Service Admin membership and starts with empty stock and starter catalog/container templates. Each additional service persists its inventory, definitions, checks, incidents, policies, and medication histories in server/data/service-<UUID>.sqlite; identity, memberships, service details, and sessions remain in inventory.sqlite. Back up all these SQLite files together while the app is stopped. Users created under a service belong to that service. Service selection is restricted to active memberships.

Service details include DEA registrant name, registration number, expiration date, schedules, registered address, contacts, and notes. DEA information is visible/editable only to an active Service Admin for the selected service. Number format/date checks do not verify registration with the DEA. Audit entries record changed field names rather than copying DEA/contact details.

Logs include the signed-in operator's historical name and username for inventory/settings actions, account/service changes, sign-in/sign-out, and access denials. New inventory and settings events also retain immutable user IDs. Older events retain their legacy attribution and are not reassigned to a user.

The local API continues to bind to loopback. For network deployment use HTTPS and set EMCORE_SECURE_COOKIE=1 behind the HTTPS proxy; never expose the local development server as a production deployment. Authentication and witness signoffs do not constitute DEA compliance.

Additional API routes:

- GET /api/auth/status: setup state / current user
- POST /api/auth/setup: first service and administrator (only before any account exists)
- POST /api/auth/login, /api/auth/logout, /api/auth/password, /api/auth/service
- GET /api/users and POST /api/users: active-service account administration
- GET /api/services and POST /api/services: memberships / service and DEA administration
- GET /api/access: session-derived identity, permissions, rules, and role templates
- GET /api/logs?q=&type=all|item|settings|access&offset=0
- POST /api/classes; POST /api/access/profiles; POST /api/access/rules

## Authenticated witness signoffs

When tag rules require a witness, completing a receipt, medication use/waste, transfer, seal break, or reseal opens a second-user signoff prompt. The witness reviews vial codes, quantities, incident/destination/seal details and enters their own credentials. The operator remains signed in. Cancelling or failing authentication saves no inventory/incident change. Drafts save without witnessing; completing them or correcting a witnessed incident requires fresh authentication. Earlier signatures remain in revision history.

The API accepts witnessCredentials only for that action and removes them before any draft, history, settings, or audit persistence. The server verifies password hashes, active membership in the selected service, a different user ID, the explicit Can Witness tag, and current witness policies. Failures are throttled independently of login attempts. No reusable approval token is returned. Signoffs persist an immutable signoff ID, actor/witness user IDs, witness name/username snapshots, service, timestamp, method, and a hash of the action request. The completed vial events and logs reference the same signoff. Legacy free-text witness names remain visible but cannot authorize a new save.

## Vial QR codes

Home → Scan QR (also available from Inventory) looks up an individual vial using the camera, a chosen QR image, or typed/scanner-entered code. Image decoding happens locally in the browser. Camera mode starts only after a button press, prefers the rear camera, and stops on detection, navigation, or closing. Camera mode requires HTTPS or localhost and camera permission; image and typed entry are alternatives.

Inventory item QR buttons and Item record → Generate / show QR label generate a QR for that vial. Download QR PNG provides an authenticated, 512-pixel PNG with a four-module white margin. Each QR contains EMCORE:1:<serviceId>:<itemId>:<eight-character-code>; it carries no medication name or credentials. Both immutable item ID and code must match in the current service. Eight-character code-only entry is also accepted. Scanning never creates medication, changes a tracking code, or silently follows an external URL. Unknown codes, wrong-service QRs, and medication visibility restrictions are enforced by the API. Lookups include used/disposed vial records.

Routes: GET /api/qr?item=<code-or-id>, GET /api/qr/image?item=<code-or-id>, and GET /api/qr/resolve?value=<encoded-QR-or-code>. All require authenticated records.view and medication view access.

QR implementation uses the maintained APIs documented by [node-qrcode](https://github.com/soldair/node-qrcode) and [QR Scanner](https://github.com/nimiq/qr-scanner).
