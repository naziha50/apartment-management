# Apartment Management — Maintenance Module

CSE327 – Software Engineering project, developed with an agile (sprint-based) process.

The system lets residents of an apartment building report maintenance problems and lets the
building admin and staff review, assign, track and resolve them (SRS v1.3, §4.3).

**Planned stack:** HTML + CSS + JavaScript frontend → REST API (Node.js + Express) → PostgreSQL.

## Status

🚧 Work in progress — Sprint 0 (project setup).

- [x] Step 1: Node.js project + Express server with a health check
- [x] Step 2: configuration (`.env`) + PostgreSQL connection
- [ ] Step 3: database migrations
- [ ] Step 4: `users` and `units` tables with demo data
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
`postgres://postgres:secret@localhost:5432/apartment_maintenance`. Then create the database:

```bash
npm run db:create
```

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
.env.example    template for your local .env (never commit .env)
```
