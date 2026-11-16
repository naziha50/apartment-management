# Apartment Management — Maintenance Module

CSE327 – Software Engineering project, developed with an agile (sprint-based) process.

The system lets residents of an apartment building report maintenance problems and lets the
building admin and staff review, assign, track and resolve them (SRS v1.3, §4.3).

**Planned stack:** HTML + CSS + JavaScript frontend → REST API (Node.js + Express) → PostgreSQL.

## Status

🚧 Work in progress — Sprint 4 (close the loop) is done; the next sprint is not planned yet.

**Sprint 0 – Setup** ✅
- [x] Step 1: Node.js project + Express server with a health check
- [x] Step 2: configuration (`.env`) + PostgreSQL connection
- [x] Step 3: database migrations
- [x] Step 4: `users` and `units` tables with demo data
- [x] Step 5: "Viewing as" user switcher (development stand-in for login)

**Sprint 1 – Report a problem** ✅
- [x] Step 6: base page layout, stylesheet and security headers
- [x] Step 7: maintenance request tables
- [x] Step 8: submit-request API (FR-16, FR-17)
- [x] Step 9: "Report a problem" page
- [x] Step 10: my requests list and request detail (FR-21)
- [x] Step 11: photo attachments (BR-19)

**Sprint 2 – Handle requests** ✅
- [x] Step 12: status rules (BR-16, Appendix A) + status-change API (FR-18, FR-20)
- [x] Step 13: "Manage requests" list for admin and staff
- [x] Step 14: action buttons on the request page (only the moves the server allows)
- [x] Step 15: assign requests to staff (FR-19)
- [x] Step 16: progress notes, including internal notes (FR-20)

**Sprint 3 – Find and follow up** ✅
- [x] Step 17: filters, search and paging on the request lists (FR-22)
- [x] Step 18: change the priority after review (FR-18)
- [x] Step 19: maintenance overview for the admin (FR-29)
- [x] Step 20: clean server shutdown + API integration tests (NFR-22)

**Sprint 4 – Close the loop** ✅
- [x] Step 21: resolved requests close automatically after 7 days (BR-18)
- [x] Step 22: residents rate a closed request once (FR-50, BR-26)
- [x] Step 23: in-app notifications for status changes, assignments and notes (FR-25), kept current while a page is open
- [x] Step 24: photos on progress notes (BR-19)

## Frontend conventions

- Plain HTML, CSS and JavaScript modules — no build step.
- One stylesheet, `public/css/main.css`, with colour tokens and reusable components
  (buttons, cards, forms, status badges, tables that turn into cards on phones).
- Every page has the same frame from `public/js/layout.js`: top bar, "Viewing as" menu and
  a navigation bar that shows only the links for the current role.
- Insert user data only with `el()` / `textContent` from `public/js/dom.js`, never `innerHTML` (NFR-05).
- No inline `<script>` blocks or `style=""` attributes: the security policy only allows
  scripts and styles from this server.
- Animations: [Motion](https://motion.dev) for entrance effects and
  [anime.js](https://animejs.com) for number count-ups, both served from `node_modules`
  at `/vendor/…`. They are skipped when the user's system asks for reduced motion.
- Usability targets: works at 360 px wide without sideways scrolling (NFR-10), contrast
  ≥ 4.5:1, visible keyboard focus and a skip link (NFR-12), touch targets ≥ 44 px.

## Who am I? ("Viewing as") — no login yet

Login and authentication (SRS FR-01, FR-02) are **out of scope** for now; this project
focuses on the maintenance module. To act as different people, the page has a
**Viewing as** menu listing the demo users. The chosen user's id is sent with every API call
in the `X-User-Id` header, and `server/middleware/current-user.js` turns it into `req.user`.

⚠ This is a **development stand-in, not security** — anyone can pick any user. All other code
only reads `req.user`, so adding real login later means changing that one middleware.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/dev/users` | Everyone you can "view as" |
| `GET /api/v1/me` | The user you are viewing as (401 if none is chosen) |

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer, running locally

## Setup

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Open `.env` and set `DATABASE_URL` for your PostgreSQL user and password, for example
`postgres://postgres:secret@localhost:5432/apartment_maintenance`. Then create the database
and its tables:

```bash
npm run db:create
npm run db:migrate
npm run db:seed
```

### Demo data

`npm run db:seed` adds one building with six units (1A – 3B) and these users. All names and
contact details are made up.

| Name | Email | Role | Notes |
|---|---|---|---|
| Building Admin | admin@example.com | Admin | Can do everything |
| Karim Uddin | staff@example.com | Staff | May see all requests and review them |
| Jamal Hossain | caretaker@example.com | Staff | No extra permissions: only requests assigned to him |
| Rahima Rahman | resident1@example.com | Resident | Owner of 1A **and** 3B (must choose a unit when reporting) |
| Tanvir Ahmed | resident2@example.com | Resident | Tenant of 2A |
| সাদিয়া ইসলাম | resident3@example.com | Resident | Owner of 2B (Bangla name) |

Units 1B and 3A are vacant.

## Database changes (migrations)

The schema is built from numbered SQL files in `db/migrations/`, applied in order by
`npm run db:migrate`. Each file runs once, inside a transaction. To change the schema, add the
next numbered file — never edit one that is already committed. See
[db/migrations/README.md](db/migrations/README.md).

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies migrations that have not run yet (safe to run any time) |
| `npm run db:reset` | **Development only — deletes all data**, then re-applies every migration |
| `npm run db:seed` | Adds the demo data (safe to run more than once) |

### Tables so far

| Migration | Tables | Purpose |
|---|---|---|
| `001_create_users_and_units.sql` | `buildings`, `users`, `staff_permissions`, `units`, `occupancies` | Who lives where and who handles requests |
| `002_create_maintenance_requests.sql` | `maintenance_requests`, `request_updates` | Requests (number `MR-YYYY-NNNNN`, status, priority, assignee) and their full history |
| `003_create_request_attachments.sql` | `request_attachments` | Photo details (BR-19). The files themselves are saved in `UPLOAD_DIR` (default `storage/uploads/`, git-ignored) under random names |
| `004_fix_request_number_overflow.sql` | — | Request numbers keep working after 99,999 (`MR-2026-99999`, then `MR-2026-100000`). The first version cut longer numbers, which made request 100,000 clash with 10,000 |
| `005_add_request_list_index.sql` | — | Index in the lists' sort order: first page of 100,000 requests in 0.1 ms instead of 89 ms |
| `006_create_request_ratings.sql` | `request_ratings` | The resident's 1–5 rating and optional comment (FR-50, BR-26). One per request, never changed: the request id is the key |
| `007_create_notifications.sql` | `notifications` | In-app messages, one row per person (FR-25). Written in the same transaction as the change they describe |
| `008_link_photos_to_notes.sql` | `request_attachments.update_id` | Which note a photo came with (BR-19). Empty for photos reported with the request. Photos on internal notes are as private as the note |

**Measured at scale** (100,000 requests in the test database, 50 users at once): about 1,250 API
requests per second, no errors, 95% of answers within 70 ms.

A request moves through the statuses in SRS BR-16 / Appendix A:
`submitted → under_review → in_progress → resolved → closed`, or ends as `rejected` or `cancelled`.

## Maintenance API

All endpoints are under `/api/v1/maintenance` and need a "Viewing as" user (`X-User-Id` header).
Errors always look like `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.

| Method & path | Who | What it does |
|---|---|---|
| `POST /requests` | Residents | Submit a request (FR-16, FR-17). Body: `title` (3–120 chars), `description`, `category`, `location` (`unit` or `common_area`), and `unitId` only if the resident has more than one apartment. Send JSON, or `multipart/form-data` to add up to 3 `photos` (JPG/PNG/WEBP, 5 MB each, BR-19). Returns 201 with the new request (status `submitted`, number `MR-YYYY-NNNNN`). |
| `GET /requests` | Everyone | Requests you may see, newest activity first, 20 per page (FR-21, FR-22): residents their own, staff those assigned to them, admins and staff with `maintenance.view_all` all of them. Optional filters: `status` (one or more, comma-separated), `category`, `priority` (`high`, `medium`, `low` or `unset`), `q` (searches the title and request number), `assigned=none` (nobody assigned yet), `page`. Returns `{ items, page, pageSize, total }` |
| `GET /requests/:id` | Everyone | One request with its `updates` (history), `attachments` (photos) and `rating`, `autoCloseAt` and `allowed` (what you may do now: `transitions`, `assign`, `addNote`, `setPriority`, `rate`). Requests you may not see answer 404 |
| `GET /requests/:id/attachments/:attId` | Everyone | One photo, with the same access rule as its request |
| `POST /requests/:id/transition` | Depends on the move | Change the status (FR-18, FR-20). Body: `to` plus `priority` when reviewing, `note` as the reason when rejecting or as the note when resolving / reopening. A move that is not allowed now answers 409 `TRANSITION_NOT_ALLOWED` |
| `POST /requests/:id/assign` | Admin, staff with `maintenance.assign` | Assign or reassign to an active staff member (FR-19). Body: `staffId`. Allowed while the request is submitted, under review or in progress (otherwise 409 `NOT_ASSIGNABLE`). Each change is added to the history |
| `POST /requests/:id/notes` | Admin, the assigned staff member, staff with `maintenance.review` | Add a progress note (FR-20). Body: `note`, and `internal: true` to keep it to staff and the admin. Send `multipart/form-data` to add up to 3 `photos` (same checks as request photos, BR-19). Not allowed once the request is closed, rejected or cancelled. Residents never receive internal notes or their photos — not in the list, and a direct photo link answers 404 |
| `PATCH /requests/:id/priority` | Admin, staff with `maintenance.review` | Change the priority after review (FR-18). Body: `priority`. Allowed while the request is under review or in progress (otherwise 409 `PRIORITY_LOCKED`). Each change is added to the history |
| `POST /requests/:id/rating` | The resident who reported it | Rate a closed request (FR-50, BR-26). Body: `rating` (1–5) and optional `comment` (up to 500 characters). Once only, within 7 days of closing; otherwise 409 `RATING_NOT_ALLOWED` with the reason. Anyone else gets 403 |
| `GET /overview` | Admin, staff with `maintenance.view_all` | Request counts for the home page (FR-29): `submitted`, `under_review`, `in_progress`, `resolved`, `closed`, `unassigned` and `high_open` (the last two count requests still needing action) |
| `GET /staff` | Admin, staff with `maintenance.assign` | Active staff, for the "assign to" picker |
| `GET /my-units` | Residents | The resident's active apartments, for the unit picker |

Photos are checked by their content, not their name: a file renamed to `.jpg` is rejected.

Who may change the status (rules in `server/modules/maintenance/state-machine.js`):

| Move | Who | Needs |
|---|---|---|
| submitted → under review | Admin, staff with `maintenance.review` | `priority` |
| submitted / under review → rejected | Admin, staff with `maintenance.review` | `note` (reason) |
| submitted → cancelled | The resident who reported it | — |
| under review → in progress | Admin or the assigned staff member, once someone is assigned | — |
| in progress → resolved | Admin or the assigned staff member | `note` |
| resolved → closed | The resident who reported it | — |
| resolved → in progress (reopen) | The resident, within 7 days of it being resolved | `note` |
| resolved → closed (automatic) | The server ("System" in the history), 7 days after it was resolved if nobody reopened it (BR-18) | — |

The automatic close runs when the server starts and then every hour. It is one database
statement, so several server processes running it at once still close each request only once.
Each request's `autoCloseAt` says when that will happen (null unless it is resolved).

Categories: `plumbing`, `electrical`, `lift`, `generator`, `water_supply`, `gas`, `cleaning`,
`security`, `common_area`, `other`.

Example (as Tanvir, user id 5):

```bash
curl -X POST http://localhost:3000/api/v1/maintenance/requests \
  -H "Content-Type: application/json" -H "X-User-Id: 5" \
  -d '{"title":"Kitchen tap leaking","description":"Drips all night","category":"plumbing","location":"unit"}'

# with a photo
curl -X POST http://localhost:3000/api/v1/maintenance/requests -H "X-User-Id: 5" \
  -F "title=Kitchen tap leaking" -F "description=Drips all night" \
  -F category=plumbing -F location=unit -F "photos=@tap.jpg"
```

## Notifications API

Under `/api/v1/notifications`, always for the "Viewing as" user only (FR-25):

| Method & path | What it does |
|---|---|
| `GET /` | My notifications, newest first, 20 per page (`?page=`). Returns `{ items, page, pageSize, total, unread }` |
| `GET /unread-count` | `{ unread }`, for the bell in the top bar |
| `POST /:id/read` | Mark one as read (someone else's answers 404) |
| `POST /read-all` | Mark all as read |

Who is told what (never about their own action, and residents never about internal notes):

| Event | Notified |
|---|---|
| New request | The admin and staff with `maintenance.review` |
| Status change (incl. reopen, reject with reason) | The resident and the assigned staff member |
| Assigned | The new assignee |
| Note | The resident and the assignee; an internal note only the assignee |
| Priority changed | The assignee |
| Closed automatically (BR-18) | The resident |

The bell stays current while a page is open: it checks every 30 seconds while the tab is
visible, and at once when you come back to the tab. When something new arrives, a short message
says so (screen readers announce it too). Checking instead of pushing works with any number of
server processes, and each check is one small indexed count.

## Run it

```bash
npm start
```

Open http://localhost:3000/api/v1/health — it should answer
`{"status":"ok","database":"connected"}`. If it says `"unreachable"`, check `DATABASE_URL`
and that PostgreSQL is running.

Then open http://localhost:3000 and pick a user in **Viewing as**.

Use `npm run dev` while coding: it restarts the server whenever a file changes.

## Tests

```bash
npm test
```

Runs every test file with Node's built-in test runner (no extra packages):

| File | What it checks |
|---|---|
| `tests/state-machine.test.js` | The rules on their own: who may change the status, assign, add notes or change the priority |
| `tests/api.test.mjs` | The real API over HTTP: submitting, who can see what, a request's whole life from review to closed, internal notes, filters, the overview and photo uploads |

The API tests use a **separate test database**: `DATABASE_URL` with `_test` added to the name
(e.g. `apartment_maintenance_test`), or `TEST_DATABASE_URL` if you set it. It is created if
needed and **wiped and re-seeded on every run**, so your development data is never touched.
Uploaded test photos go to a temporary folder that is deleted afterwards. If PostgreSQL is
not running, the API tests are skipped with the reason shown and the rule tests still run.

## Stopping the server

Press Ctrl+C. Requests that are already running get up to 5 seconds to finish, then every
connection is closed (browsers keep spare connections open, which used to make the server
hang), the database connections are closed, and the server exits.

## Project layout

```
server/
  app.js        builds the Express app (routes are added here)
  server.js     starts the HTTP server
  config.js     all settings, read from .env
  db/pool.js    shared PostgreSQL connection pool + transaction helper
  lib/errors.js API errors with plain-language messages
  lib/validate.js  input checking that reports every field problem at once
  middleware/   current-user.js ("Viewing as" → req.user), error-handler.js (one JSON error shape),
                security.js (security headers)
  modules/      one folder per feature
    users/        lists users and answers /me
    maintenance/  routes (HTTP) → service (checks + transactions) → repository (SQL)
                  state-machine.js  who may change status, assign, add notes, change priority
                  uploads.js        photo upload checks and storage
                  maintenance.constants.js  categories, statuses, priorities
    notifications/  in-app notifications: routes → service (notify) → repository
public/
  index.html               start page (+ maintenance overview for the office)
  request.html             one request: details, photos, history, actions
  notifications.html       my notifications (the bell in the top bar)
  resident/new-request.html, resident/requests.html   report a problem, my requests
  manage/requests.html     requests list with filters for the admin and staff
  css/main.css             the one stylesheet
  js/api.js                fetch wrapper that sends X-User-Id with every call
  js/dom.js                safe element helpers (el, replace, icon)
  js/format.js             labels, badges and Bangladesh-time dates
  js/photos.js             photo checks, previews and photo fields (report form and notes)
  js/layout.js             shared page frame: top bar, "Viewing as", navigation
  js/ui.js                 animations, toasts, form errors, paging, empty and error states
  js/viewing-as.js         the "Viewing as" menu
  js/pages/                one script per page
db/
  create-db.js  creates the database (npm run db:create)
  migrate.js    applies migrations (npm run db:migrate / db:reset)
  migrations/   numbered .sql files that build the schema step by step
  seed.js       demo building, units and users (npm run db:seed)
tests/          rule tests, upload tests and API tests (npm test)
storage/        uploaded photos (git-ignored; set by UPLOAD_DIR)
.env.example    template for your local .env (never commit .env)
```
