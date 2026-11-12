# Apartment Management — Maintenance Module

CSE327 – Software Engineering project, developed with an agile (sprint-based) process.

The system lets residents of an apartment building report maintenance problems and lets the
building admin and staff review, assign, track and resolve them (SRS v1.3, §4.3).

**Planned stack:** HTML + CSS + JavaScript frontend → REST API (Node.js + Express) → PostgreSQL.

## Status

🚧 Work in progress — Sprint 0 (project setup).

- [x] Step 1: Node.js project + Express server with a health check
- [x] Step 2: configuration (`.env`) + PostgreSQL connection
- [x] Step 3: database migrations
- [x] Step 4: `users` and `units` tables with demo data
- [ ] Step 5: "Viewing as" user switcher (development stand-in for login)

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

Use `npm run dev` while coding: it restarts the server whenever a file changes.

## Project layout

```
server/
  app.js        builds the Express app (routes are added here)
  server.js     starts the HTTP server
  config.js     all settings, read from .env
  db/pool.js    shared PostgreSQL connection pool + transaction helper
db/
  create-db.js  creates the database (npm run db:create)
  migrate.js    applies migrations (npm run db:migrate / db:reset)
  migrations/   numbered .sql files that build the schema step by step
  seed.js       demo building, units and users (npm run db:seed)
.env.example    template for your local .env (never commit .env)
```
