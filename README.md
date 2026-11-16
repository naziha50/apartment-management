# Apartment Management

A web application that brings the daily work of an apartment building into one place:
residents, units, bills and payments, maintenance requests, announcements and reports.
It is written for apartment buildings in Bangladesh (amounts in BDT, times in Asia/Dhaka,
English and Bangla text).

CSE327 – Software Engineering project, built in sprints from the
**Software Requirements Specification (SRS) v1.3**.

> **Current state:** the **Maintenance** module (SRS §4.3) is built, tested and runs end to
> end, together with the in-app notifications it needs. Every other module in the SRS is
> planned but **not built yet**, and there is no real login yet (see
> [Who am I?](#5-who-am-i-viewing-as--no-login-yet)).

**Contents**

1. [Project overview (full SRS scope)](#1-project-overview-full-srs-scope)
2. [What is built so far](#2-what-is-built-so-far)
3. [Run it: step-by-step guide](#3-run-it-step-by-step-guide)
4. [Try it: a guided walkthrough](#4-try-it-a-guided-walkthrough)
5. [Who am I? ("Viewing as")](#5-who-am-i-viewing-as--no-login-yet)
6. [Maintenance rules](#6-maintenance-rules)
7. [API reference](#7-api-reference)
8. [Database and migrations](#8-database-and-migrations)
9. [Tests](#9-tests)
10. [Frontend conventions](#10-frontend-conventions)
11. [Project layout](#11-project-layout)
12. [Sprint history](#12-sprint-history)
13. [Roadmap: what is left](#13-roadmap-what-is-left)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Project overview (full SRS scope)

### The problem

Many apartment buildings run on paper records, phone calls, chat apps and separate payment
channels. Replies are late, bills go wrong and repair requests get forgotten. This system
gives one building one central place for all of that.

### Who uses it

| User | Who they are | What they do |
|---|---|---|
| **Resident** | Owner or tenant. Mostly on a phone, low to medium technical skill | Sees their bills and payments, reports payments, reports and tracks maintenance problems, reads announcements |
| **Administrator** | Building manager or committee member. Uses a computer daily | Everything: residents, units, staff, fees, bills, payments, maintenance, announcements, reports, settings |
| **Staff** | Caretaker or office worker. Mostly on a phone | Only what the admin allows (SRS Appendix B). By default: the maintenance requests assigned to them |

### Modules

| Module | Main functions (SRS) | Status |
|---|---|---|
| **Users & residents** (§4.1) | Login and passwords, roles and staff permissions, resident profiles, household members, units and occupancy, bulk import, directory, move-out wizard | ⏳ Not built. Demo users and units come from a seed script |
| **Billing & finances** (§4.2) | Fees, opening balances, monthly bills, payments and voiding, resident payment reports, receipts, statements, no-dues certificates, building expenses, finance reports | ⏳ Not built |
| **Maintenance** (§4.3) | Submit, review, prioritise, assign, update, close, rate and report on requests; scheduled recurring jobs | ✅ **Built** (scheduled jobs and a few report items are still open, see §2) |
| **Announcements & notifications** (§4.4) | Targeted and scheduled announcements, printable notices, emergency contacts, in-app notifications, read tracking | 🟡 In-app notifications for maintenance are built. Announcements are not |
| **Dashboard & reports** (§4.5) | Building, billing and maintenance overviews, activity log, search, CSV export, committee report | 🟡 Maintenance overview is built. The rest is not |
| **General** (§4.6) | English / Bangla interface, install on phone, larger text | ⏳ Not built (Bangla *text* in data already works) |

### Technology

| Layer | Choice |
|---|---|
| Frontend | Plain HTML, CSS and JavaScript modules. No framework, no build step |
| Backend | Node.js 20+ with Express 5, REST API with JSON (`/api/v1/...`) |
| Database | PostgreSQL 14+ (transactions and foreign keys, SRS SI-02) |
| File storage | Uploaded photos on disk, outside the web folder. The database stores only file details (SI-03) |
| Tests | Node's built-in test runner (`node --test`), no extra test packages |
| Animation | [Motion](https://motion.dev) and [anime.js](https://animejs.com), both off when the system asks for reduced motion |

Runtime dependencies are deliberately few: `express`, `pg`, `multer` (photo uploads),
`dotenv` (settings), `motion` and `animejs`.

### Code structure

The server is split into one folder per module (SRS NFR-20). Each module has three layers:

```
routes (HTTP in/out)  →  service (rules, permissions, transactions)  →  repository (SQL only)
```

The business rules that decide *who may do what* live in plain functions
(`server/modules/maintenance/state-machine.js`) so they can be tested without a database.
New modules (billing, announcements, …) will follow the same pattern next to `maintenance/`.

---

## 2. What is built so far

### Maintenance requirements covered

| SRS item | What works today |
|---|---|
| **FR-16** Submit a request | Title, description, category (10 types), "in my unit" or "common area", up to 3 photos. Missing fields are named next to the field. The request gets a number `MR-YYYY-NNNNN` and status *Submitted*. The office is notified |
| **FR-17** Automatic resident and unit | The resident, unit and time are taken from the server, never from the form. A resident with two units must choose one; with one unit it is filled in |
| **FR-18** Review and prioritise | The review queue can be sorted oldest first, and overdue requests carry a red *Overdue* badge. "Start review" with a priority (Low / Medium / High) moves it to *Under review*. Priority can be changed later. Reject needs a reason, and the resident is notified |
| **FR-19** Assign to staff | Pick an active staff member, reassign later. Every change is kept in the history and the new assignee is notified |
| **FR-20** Status and progress | Only the moves in SRS Appendix A are offered. *Resolved* needs a note. Notes can be internal (hidden from the resident) and can carry up to 3 photos. Updates are saved with name and time and cannot be edited |
| **FR-21** Track my requests | Residents see status, priority, assignee and non-internal notes of their own requests only |
| **FR-22** History and reports | Lists with filters by status, category, priority, apartment, assigned staff (or nobody), overdue, and submission date range (Bangladesh days), plus search by title or number; 20 per page. A **Report** page (admin, staff with `reports.view`) shows, for any period: requests per status and category, average time to resolve overall, per category and per staff member, and the 5 apartments with the most requests |
| **FR-38** Export to CSV | "Download CSV" on the requests page saves every request matching the current filters (not just one page) as a spreadsheet file. It opens correctly in Excel and Google Sheets, including Bangla names; dates are in Bangladesh time. Text a spreadsheet would run as a formula (e.g. a title starting with `=`) is kept as plain text. Internal notes are never included |
| **FR-25 / FR-26** Notifications | Bell with unread count on every page, kept current while the page is open; list of past notifications, mark one or all as read; clicking opens the request |
| **FR-29** Maintenance overview | Admin home page shows overdue requests (highlighted), counts per status, unassigned and open high-priority requests; each count links to the filtered list |
| **FR-35** Cancel, confirm, reopen | Cancel while *Submitted*; confirm a *Resolved* request (→ *Closed*) or reopen it within 7 days with a comment |
| **FR-50** Rate a request | 1–5 stars and an optional comment, once, within 7 days after closing. The admin and assignee see it; the report shows the average rating overall, per category and per staff member |
| **BR-16** Statuses | Seven statuses and the allowed moves of Appendix A, enforced on the server |
| **BR-17** Resolution targets | High 24 hours, Medium 3 days, Low 7 days from submission; without a priority it must be reviewed within 2 days. A request still needing action past its target is *overdue*: shown on the lists, the request page ("Resolve by" / "Review by") and the overview, and filterable. The targets are fixed in `maintenance.constants.js` until a settings screen exists |
| **BR-18** Auto-close | A *Resolved* request closes by itself 7 days later unless reopened |
| **BR-19** Photos | JPG, PNG or WEBP, 5 MB each, up to 3; checked by file *content*, saved under random names |
| **BR-26** Ratings | Once only, never changed (one rating per request is enforced by the database) |

### Quality requirements covered

| SRS item | How |
|---|---|
| NFR-02 Server-side checks | Every endpoint checks role and permission on the server; buttons only show what the server allows |
| NFR-04 Input checking | Every input is checked on the server; all SQL uses parameters |
| NFR-05 No script injection | User text is inserted only as text, never as HTML; a strict Content Security Policy |
| NFR-06 Safe uploads | Content checked, random names, stored outside the web folder, never executed |
| NFR-10 Phones | Works at 360 px wide without sideways scrolling; tables become cards |
| NFR-12 Accessibility | Labels, keyboard use, visible focus, skip link, contrast ≥ 4.5:1. Lighthouse scores 100 on every page |
| NFR-14 All-or-nothing | Every change and its history and notifications are saved in one database transaction |
| NFR-17 / NFR-18 Speed | Tested with 100,000 requests and 50 users at once: about 1,250 requests per second, 95% of answers within 70 ms |
| NFR-24 Privacy | A resident asking for another resident's request (or photo) gets "not found", not "forbidden" |
| NFR-28 Bangla | Bangla names and text are stored and shown correctly (one demo resident has a Bangla name) |

### Not built yet in the maintenance module

- **FR-49 / BR-25 Scheduled maintenance tasks** (e.g. monthly lift servicing).
- Real login (FR-01, FR-02) — see the next sections.

---

## 3. Run it: step-by-step guide

### 3.1 Install the tools (once per computer)

| Tool | Version | Check with |
|---|---|---|
| Node.js | 20.11 or newer | `node --version` |
| PostgreSQL | 14 or newer | `psql --version` |
| Git | any | `git --version` |

- **macOS (Homebrew):** `brew install node postgresql@16`, then `brew services start postgresql@16`.
  The database user is usually your macOS login name, with no password.
- **Windows:** install Node.js LTS from [nodejs.org](https://nodejs.org) and PostgreSQL from
  [postgresql.org/download/windows](https://www.postgresql.org/download/windows/). Remember the
  password you give the `postgres` user during setup. PostgreSQL then runs as a Windows service.
- **Linux (Debian/Ubuntu):** `sudo apt install nodejs npm postgresql`, then
  `sudo systemctl start postgresql`. Set a password for the `postgres` user with
  `sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'secret';"`.

### 3.2 Get the code and its packages

```bash
git clone <repository-url> apartment-management
cd apartment-management
npm install
```

### 3.3 Settings (`.env`)

```bash
cp .env.example .env        # Windows (cmd): copy .env.example .env
```

Open `.env` and set `DATABASE_URL` to your PostgreSQL user and password:

| Setting | Meaning | Example |
|---|---|---|
| `DATABASE_URL` | Where the database is | macOS: `postgres://localhost:5432/apartment_maintenance`<br>Windows/Linux: `postgres://postgres:secret@localhost:5432/apartment_maintenance` |
| `PORT` | Web server port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `UPLOAD_DIR` | Where photos are saved (keep it outside `public/`) | `./storage/uploads` |
| `TEST_DATABASE_URL` | Optional: database for the tests | default: `DATABASE_URL` with `_test` added to the name |

Never commit `.env`.

### 3.4 Create the database, its tables and the demo data

```bash
npm run db:create     # creates the database named in DATABASE_URL (skips it if it exists)
npm run db:migrate    # builds all tables (safe to run again)
npm run db:seed       # adds the demo building, 6 units and 6 users (safe to run again)
```

### 3.5 Start the server

```bash
npm start             # or: npm run dev  (restarts by itself when a file changes)
```

Check it: open <http://localhost:3000/api/v1/health>. It should show
`{"status":"ok","database":"connected"}`.

Then open **<http://localhost:3000>** and choose a person in the **Viewing as** menu at the top.

### 3.6 Stop the server

Press **Ctrl+C**. Running requests get up to 5 seconds to finish, then the connections and the
database pool are closed and the server exits.

### All commands

| Command | What it does |
|---|---|
| `npm start` | Starts the server |
| `npm run dev` | Starts the server and restarts it when a file changes |
| `npm test` | Runs all tests (uses a separate test database) |
| `npm run db:create` | Creates the database |
| `npm run db:migrate` | Applies new migrations |
| `npm run db:seed` | Adds the demo data |
| `npm run db:reset` | **Deletes all data** and rebuilds every table (development only). Run `db:seed` after it |

---

## 4. Try it: a guided walkthrough

The demo building is *Green Valley Apartments* with units 1A–3B. All names and contact
details are made up.

| Name | Email | Role | What they can do |
|---|---|---|---|
| Building Admin | admin@example.com | Admin | Everything |
| Karim Uddin | staff@example.com | Staff | Sees all requests and reviews them (`maintenance.view_all`, `maintenance.review`) |
| Jamal Hossain | caretaker@example.com | Staff | No extra permissions: only requests assigned to him |
| Rahima Rahman | resident1@example.com | Resident | Owner of 1A **and** 3B, so she chooses a unit when reporting |
| Tanvir Ahmed | resident2@example.com | Resident | Tenant of 2A |
| সাদিয়া ইসলাম | resident3@example.com | Resident | Owner of 2B (Bangla name) |

Units 1B and 3A are empty.

Follow one request through its whole life:

1. **Tanvir reports a problem.** Viewing as *Tanvir* → **Report a problem**. Fill in the title,
   description and category, and add a photo if you like. The request appears in **My
   requests** as *Submitted* with a number like `MR-2026-00001`.
2. **The office sees it.** Viewing as *Building Admin*, the bell shows a new notification and
   the home page counts one *Submitted* request. Open it from **Manage requests**.
3. **Review and assign.** Click **Start review**, choose a priority, then **Assign** it to
   *Jamal Hossain*. Jamal gets a notification.
4. **Work on it.** Viewing as *Jamal*: open the request, **Start work** (→ *In progress*), add
   a progress note with a photo, and add an *internal* note. Then **Mark as resolved** with a
   resolution note.
5. **Tanvir checks it.** Viewing as *Tanvir*: he sees the public note and its photo but not
   the internal note. He can choose **Yes, it is fixed** (→ *Closed*) or **It is not fixed**
   to reopen it with a comment. If he does nothing, it closes by itself after 7 days.
6. **Rate it.** After closing, Tanvir can give 1–5 stars and a comment, once.

Other things to try: Rahima must choose between her two units when reporting; a resident can
cancel a request while it is still *Submitted*; a renamed non-photo file is rejected; the
pages work at phone width.

---

## 5. Who am I? ("Viewing as") — no login yet

Login and passwords (SRS FR-01, FR-02, FR-31) are not built yet; this phase focuses on the
maintenance module. To act as different people, every page has a **Viewing as** menu
listing the demo users. The chosen user's id is sent with every API call in the `X-User-Id`
header, and `server/middleware/current-user.js` turns it into `req.user`.

⚠ This is a **development stand-in, not security**: anyone can pick any user. Everything else
only reads `req.user`, so adding real login later means replacing that one middleware.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/dev/users` | Everyone you can "view as" |
| `GET /api/v1/me` | The user you are viewing as (401 if none is chosen) |

---

## 6. Maintenance rules

### Statuses (BR-16, Appendix A)

```
submitted ──► under_review ──► in_progress ──► resolved ──► closed
    │               │                ▲              │
    ├─► cancelled   └─► rejected     └── reopen ────┘
    └─► rejected
```

*Closed*, *Rejected* and *Cancelled* are final.

| Move | Who | Needs |
|---|---|---|
| submitted → under review | Admin, staff with `maintenance.review` | `priority` |
| submitted / under review → rejected | Admin, staff with `maintenance.review` | `note` (reason) |
| submitted → cancelled | The resident who reported it | — |
| under review → in progress | Admin or the assigned staff member, once someone is assigned | — |
| in progress → resolved | Admin or the assigned staff member | `note` |
| resolved → closed | The resident who reported it | — |
| resolved → in progress (reopen) | The resident, within 7 days of it being resolved | `note` |
| resolved → closed (automatic) | The server ("System" in the history), 7 days after it was resolved (BR-18) | — |

The automatic close runs when the server starts and then every hour. It is one database
statement, so several server processes running it at once still close each request only once.

### Who sees what

- **Residents:** only their own requests, never internal notes or photos on internal notes.
- **Staff:** the requests assigned to them; all requests with `maintenance.view_all`.
- **Admin:** everything.

### Who is notified (FR-25)

Nobody is notified about their own action, and residents are never told about internal notes.

| Event | Notified |
|---|---|
| New request | The admin and staff with `maintenance.review` |
| Status change (including reopen and reject) | The resident and the assigned staff member |
| Assigned | The new assignee |
| Note | The resident and the assignee; an internal note only the assignee |
| Priority changed | The assignee |
| Closed automatically | The resident |

The bell checks every 30 seconds while the tab is visible, and at once when you return to the
tab. A short message (also read out by screen readers) says when something new arrives.

---

## 7. API reference

All endpoints are under `/api/v1` and need a "Viewing as" user (`X-User-Id` header), except
`/health` and `/dev/users`. Errors always look like
`{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.

### Maintenance (`/api/v1/maintenance`)

| Method & path | Who | What it does |
|---|---|---|
| `POST /requests` | Residents | Submit a request (FR-16, FR-17). Body: `title` (3–120 chars), `description`, `category`, `location` (`unit` or `common_area`), and `unitId` only if the resident has more than one unit. JSON, or `multipart/form-data` with up to 3 `photos`. Returns 201 with the new request |
| `GET /requests` | Everyone | Requests you may see, newest activity first, 20 per page. Filters: `status` (comma-separated), `category`, `priority` (`high`, `medium`, `low`, `unset`), `q` (title or number), `assigned=none` or `assignedTo` (a staff id), `unitId`, `from` / `to` (`YYYY-MM-DD`, the Bangladesh day it was submitted; `to` includes the whole day), `overdue=1` (BR-17), `page`. `sort=oldest` lists the longest-waiting first (FR-18). Returns `{ items, page, pageSize, total }` |
| `GET /requests/:id` | Everyone | One request (like every request in the API: with `dueAt` and `overdue`, BR-17) with `updates` (history), `attachments`, `rating`, `autoCloseAt` and `allowed` (what you may do now: `transitions`, `assign`, `addNote`, `setPriority`, `rate`). Requests you may not see answer 404 |
| `GET /requests/:id/attachments/:attId` | Everyone | One photo, with the same access rule as its request |
| `POST /requests/:id/transition` | Depends on the move | Change the status. Body: `to`, plus `priority` when reviewing and `note` when rejecting, resolving or reopening. A move not allowed now answers 409 `TRANSITION_NOT_ALLOWED` |
| `POST /requests/:id/assign` | Admin, staff with `maintenance.assign` | Assign or reassign. Body: `staffId`. Only while submitted, under review or in progress (else 409 `NOT_ASSIGNABLE`) |
| `POST /requests/:id/notes` | Admin, the assignee, staff with `maintenance.review` | Add a note. Body: `note`, optional `internal: true`. `multipart/form-data` to add up to 3 `photos`. Not allowed once the request is final |
| `PATCH /requests/:id/priority` | Admin, staff with `maintenance.review` | Change the priority while under review or in progress (else 409 `PRIORITY_LOCKED`) |
| `POST /requests/:id/rating` | The resident who reported it | Body: `rating` (1–5), optional `comment` (≤ 500 chars). Once, within 7 days of closing (else 409 `RATING_NOT_ALLOWED`) |
| `GET /overview` | Admin, staff with `maintenance.view_all` | Counts for the home page: per status, `unassigned`, `high_open`, `overdue` |
| `GET /staff` | Admin, staff with `maintenance.assign` | Active staff, for the "assign to" picker |
| `GET /export.csv` | Admin and staff | The request list as CSV (FR-38), with the same filters and the same "who sees what" as `GET /requests`, every page at once (up to 10,000 rows; more answers 400 asking for narrower filters). UTF-8 with a byte-order mark; formula-like cells are prefixed with `'` |
| `GET /report` | Admin, staff with `reports.view` | The maintenance report for requests submitted between `from` and `to` (optional `YYYY-MM-DD`, Bangladesh days): `byStatus`, `overall`, `byCategory` (busiest first), `topUnits` (5, problems inside the apartment only) and `byStaff`. Each figure set has `requests`, `resolved`, `avgHoursToResolve`, `ratings` and `avgRating` (null when there is nothing to average). Time to resolve runs from submission to the latest resolve |
| `GET /filter-options` | Admin, staff with `maintenance.view_all` | `{ units, staff }` for the list filters; staff includes deactivated members (`active: false`) so their old requests can still be found |
| `GET /my-units` | Residents | The resident's active units, for the unit picker |

Categories: `plumbing`, `electrical`, `lift`, `generator`, `water_supply`, `gas`, `cleaning`,
`security`, `common_area`, `other`.

### Notifications (`/api/v1/notifications`)

Always for the "Viewing as" user only.

| Method & path | What it does |
|---|---|
| `GET /` | My notifications, newest first, 20 per page (`?page=`). Returns `{ items, page, pageSize, total, unread }` |
| `GET /unread-count` | `{ unread }`, for the bell |
| `POST /:id/read` | Mark one as read (someone else's answers 404) |
| `POST /read-all` | Mark all as read |

### Other

| Method & path | What it does |
|---|---|
| `GET /api/v1/health` | `{ status, database }`: is the server up and the database reachable |

### Example (as Tanvir, user id 5)

```bash
curl -X POST http://localhost:3000/api/v1/maintenance/requests \
  -H "Content-Type: application/json" -H "X-User-Id: 5" \
  -d '{"title":"Kitchen tap leaking","description":"Drips all night","category":"plumbing","location":"unit"}'

# with a photo
curl -X POST http://localhost:3000/api/v1/maintenance/requests -H "X-User-Id: 5" \
  -F "title=Kitchen tap leaking" -F "description=Drips all night" \
  -F category=plumbing -F location=unit -F "photos=@tap.jpg"
```

---

## 8. Database and migrations

The schema is built from numbered SQL files in `db/migrations/`, applied in order by
`npm run db:migrate`. Each file runs once, inside a transaction. To change the schema, add the
next numbered file; never edit one that is already committed. See
[db/migrations/README.md](db/migrations/README.md).

| Migration | Tables | Purpose |
|---|---|---|
| `001_create_users_and_units.sql` | `buildings`, `users`, `staff_permissions`, `units`, `occupancies` | Who lives where and who handles requests. Every building table has a `building_id`, ready for more buildings later (NFR-26) |
| `002_create_maintenance_requests.sql` | `maintenance_requests`, `request_updates` | Requests (number, status, priority, assignee) and their full history |
| `003_create_request_attachments.sql` | `request_attachments` | Photo details (BR-19); the files are in `UPLOAD_DIR` |
| `004_fix_request_number_overflow.sql` | — | Request numbers keep working past 99,999 |
| `005_add_request_list_index.sql` | — | Index for the request lists (first page of 100,000 requests in 0.1 ms instead of 89 ms) |
| `006_create_request_ratings.sql` | `request_ratings` | One rating per request (FR-50, BR-26) |
| `007_create_notifications.sql` | `notifications` | In-app notifications, one row per person (FR-25) |
| `008_link_photos_to_notes.sql` | `request_attachments.update_id` | Which note a photo belongs to; empty for photos sent with the request |

The `users`, `units` and `occupancies` tables already follow the SRS data model, but there are
no screens to manage them yet: they are filled by `npm run db:seed`.

---

## 9. Tests

```bash
npm test
```

| File | What it checks |
|---|---|
| `tests/state-machine.test.js` | The rules on their own: who may change the status, assign, add notes, change the priority or rate; deadlines and overdue (BR-17) |
| `tests/csv.test.js` | The CSV helper: Bangla and quotes survive, formulas stay text |
| `tests/uploads.test.js` | Photo checks: real images pass, renamed files are refused |
| `tests/api.test.mjs` | The real API over HTTP: submitting, who sees what, a request's whole life, internal notes and their photos, filters (including unit, staff and Bangladesh-day date range), the overview, ratings, auto-close, notifications, uploads, overdue requests, the report and the CSV export |

The API tests use a **separate test database** (`DATABASE_URL` with `_test` added, or
`TEST_DATABASE_URL`). It is created if needed and **wiped and re-seeded on every run**, so your
development data is never touched; the tests refuse to run against the development database.
Test photos go to a temporary folder that is deleted afterwards. If PostgreSQL is not running,
the API tests are skipped with the reason shown and the other tests still run.

Current result: **30 tests, all passing.**

---

## 10. Frontend conventions

- Plain HTML, CSS and JavaScript modules; no build step.
- One stylesheet, `public/css/main.css`, with colour tokens and reusable parts (buttons, cards,
  forms, status badges, tables that become cards on phones).
- Every page gets the same frame from `public/js/layout.js`: top bar with the bell, "Viewing as"
  menu, and navigation that shows only the links for the current role.
- User data is inserted only with `el()` / `textContent` from `public/js/dom.js`, never
  `innerHTML` (NFR-05).
- No inline `<script>` or `style=""`: the security policy only allows files from this server.
- Statuses always have a text label as well as a colour (UI-06). Dates are shown in Bangladesh time.
- Animations are served from `node_modules` at `/vendor/…` and skipped for reduced motion.

---

## 11. Project layout

```
server/
  app.js            builds the Express app and mounts the routes
  server.js         starts the HTTP server, the hourly auto-close, and clean shutdown
  config.js         all settings, read from .env
  db/pool.js        shared PostgreSQL pool + transaction helper
  lib/errors.js     API errors with plain-language messages
  lib/validate.js   input checking that reports every field problem at once
  lib/csv.js        CSV files for spreadsheets (FR-38)
  middleware/       current-user.js ("Viewing as" → req.user), error-handler.js, security.js (headers)
  modules/          one folder per module
    users/            lists users and answers /me
    maintenance/      routes → service → repository
                      state-machine.js            who may do what (pure functions)
                      uploads.js                  photo checks and storage
                      maintenance.constants.js    categories, statuses, priorities, time limits
    notifications/    in-app notifications: routes → service → repository
public/
  index.html                  home page (+ maintenance overview for the office)
  request.html                one request: details, photos, history, actions
  notifications.html          my notifications
  resident/new-request.html   report a problem
  resident/requests.html      my requests
  manage/requests.html        request list with filters, for admin and staff
  manage/report.html          maintenance report (admin, staff with reports.view)
  css/main.css                the one stylesheet
  js/api.js                   fetch wrapper that sends X-User-Id
  js/dom.js                   safe element helpers
  js/format.js                labels, badges, Bangladesh-time dates
  js/layout.js                shared page frame and the notification bell
  js/photos.js                photo checks, previews and photo fields
  js/ui.js                    animations, toasts, form errors, paging, empty and error states
  js/viewing-as.js            the "Viewing as" menu
  js/pages/                   one script per page
db/
  create-db.js   migrate.js   seed.js
  migrations/    numbered .sql files
tests/           rule, CSV, upload and API tests
storage/         uploaded photos (git-ignored)
.env.example     template for your .env
```

---

## 12. Sprint history

**Sprint 0 – Setup** ✅
- Step 1: Node.js project and Express server with a health check
- Step 2: settings (`.env`) and PostgreSQL connection
- Step 3: database migrations
- Step 4: `users` and `units` tables with demo data
- Step 5: "Viewing as" user switcher (stand-in for login)

**Sprint 1 – Report a problem** ✅
- Step 6: page layout, stylesheet and security headers
- Step 7: maintenance request tables
- Step 8: submit-request API (FR-16, FR-17)
- Step 9: "Report a problem" page
- Step 10: my requests list and request page (FR-21)
- Step 11: photo attachments (BR-19)

**Sprint 2 – Handle requests** ✅
- Step 12: status rules (BR-16, Appendix A) and status-change API (FR-18, FR-20)
- Step 13: "Manage requests" list for admin and staff
- Step 14: action buttons showing only the moves the server allows
- Step 15: assign requests to staff (FR-19)
- Step 16: progress notes, including internal notes (FR-20)

**Sprint 3 – Find and follow up** ✅
- Step 17: filters, search and paging (FR-22)
- Step 18: change the priority after review (FR-18)
- Step 19: maintenance overview for the admin (FR-29)
- Step 20: clean server shutdown and API integration tests (NFR-22)

**Sprint 4 – Close the loop** ✅
- Step 21: resolved requests close automatically after 7 days (BR-18)
- Step 22: residents rate a closed request once (FR-50, BR-26)
- Step 23: in-app notifications, kept current while a page is open (FR-25, FR-26)
- Step 24: photos on progress notes (BR-19)

**Sprint 5 – Deadlines and reports** ✅ (maintenance only)
- [x] Step 25: overdue requests by priority (BR-17), oldest-first review queue (FR-18), overdue count on the overview (FR-29)
- [x] Step 26: more list filters: unit, assigned staff, date range (FR-22)
- [x] Step 27: maintenance report: average time to resolve, busiest units and categories, average ratings (FR-22, FR-50)
- [x] Step 28: CSV export of the request list (FR-38)

Next: scheduled maintenance tasks (FR-49, BR-25).

---

## 13. Roadmap: what is left

Not planned in detail yet. In SRS priority order (Must first):

1. **Finish maintenance (this team's part):** Sprint 5 above, then scheduled tasks (FR-49).
2. **Users & residents:** real login with hashed passwords and lockout, sessions, password
   change and reset (FR-01, FR-02, FR-31, BR-02); screens for residents, units, occupancy and
   staff permissions (FR-03 – FR-08); then bulk import, household members, move-out (FR-42,
   FR-54, FR-56). Real login replaces the "Viewing as" middleware.
3. **Billing & finances:** fees, monthly bills, payments, opening balances, receipts (FR-09 –
   FR-15, FR-32, FR-41), then payment reports, voiding, statements, certificates and expenses
   (FR-33, FR-39, FR-40, FR-43 – FR-46).
4. **Announcements:** publish, target and schedule (FR-23, FR-24, FR-36, FR-51), read status
   (FR-26), emergency contacts and printable notices (FR-52, FR-53).
5. **Dashboard & reports:** building and billing overview, collection rate, activity log,
   search, committee report (FR-27, FR-28, FR-30, FR-34, FR-57, FR-58).
6. **General:** Bangla interface, install on phone, larger text (FR-47, FR-48, FR-55);
   daily backups and a tested restore (NFR-15, NFR-16); OpenAPI documentation (NFR-21).

---

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| Health check says `"database":"unreachable"` | PostgreSQL is not running, or `DATABASE_URL` is wrong. Start PostgreSQL (§3.1) and check the user, password and port |
| `npm run db:create` says *password authentication failed* | Put the right password in `DATABASE_URL` (Windows/Linux: the `postgres` user's password) |
| `role "postgres" does not exist` (macOS) | Use your macOS login name instead: `postgres://localhost:5432/apartment_maintenance` |
| `relation ... does not exist` | Run `npm run db:migrate` |
| The "Viewing as" menu is empty | Run `npm run db:seed` |
| `EADDRINUSE: address already in use :::3000` | Another server is running. Stop it, or set another `PORT` in `.env` |
| API tests say *skipped* | PostgreSQL is not running; start it and run `npm test` again |
| A photo is refused | Only real JPG, PNG or WEBP files up to 5 MB, at most 3 at a time |
