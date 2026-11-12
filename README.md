# Apartment Management — Maintenance Module

CSE327 – Software Engineering project, developed with an agile (sprint-based) process.

The system lets residents of an apartment building report maintenance problems and lets the
building admin and staff review, assign, track and resolve them (SRS v1.3, §4.3).

**Planned stack:** HTML + CSS + JavaScript frontend → REST API (Node.js + Express) → PostgreSQL.

## Status

🚧 Work in progress — Sprint 1 (report a problem).

**Sprint 0 – Setup** ✅
- [x] Step 1: Node.js project + Express server with a health check
- [x] Step 2: configuration (`.env`) + PostgreSQL connection
- [x] Step 3: database migrations
- [x] Step 4: `users` and `units` tables with demo data
- [x] Step 5: "Viewing as" user switcher (development stand-in for login)

**Sprint 1 – Report a problem**
- [x] Step 6: base page layout, stylesheet and security headers
- [ ] Step 7: maintenance request tables
- [ ] Step 8: submit-request API (FR-16, FR-17)
- [ ] Step 9: "Report a problem" page
- [ ] Step 10: my requests list and request detail (FR-21)
- [ ] Step 11: photo attachments (BR-19)

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

## Run it

```bash
npm start
```

Open http://localhost:3000/api/v1/health — it should answer
`{"status":"ok","database":"connected"}`. If it says `"unreachable"`, check `DATABASE_URL`
and that PostgreSQL is running.

Then open http://localhost:3000 and pick a user in **Viewing as**.

Use `npm run dev` while coding: it restarts the server whenever a file changes.

## Project layout

```
server/
  app.js        builds the Express app (routes are added here)
  server.js     starts the HTTP server
  config.js     all settings, read from .env
  db/pool.js    shared PostgreSQL connection pool + transaction helper
  lib/errors.js API errors with plain-language messages
  middleware/   current-user.js ("Viewing as" → req.user), error-handler.js (one JSON error shape),
                security.js (security headers)
  modules/      one folder per feature; users/ lists users and answers /me
public/
  index.html    start page
  css/main.css  the one stylesheet
  js/api.js     fetch wrapper that sends X-User-Id with every call
  js/dom.js     safe element helpers (el, replace, icon)
  js/layout.js  shared page frame: top bar, "Viewing as", navigation
  js/ui.js      animations, toasts, empty and error states
  js/viewing-as.js  the "Viewing as" menu
  js/pages/     one script per page
db/
  create-db.js  creates the database (npm run db:create)
  migrate.js    applies migrations (npm run db:migrate / db:reset)
  migrations/   numbered .sql files that build the schema step by step
  seed.js       demo building, units and users (npm run db:seed)
.env.example    template for your local .env (never commit .env)
```
