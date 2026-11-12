# Database migrations

Each file in this folder changes the database schema one step at a time.
`npm run db:migrate` applies the ones that have not run yet, in name order.

## Rules

1. **Name:** three-digit number + short description in `snake_case`, e.g.
   `001_create_users_and_units.sql`, `002_create_maintenance_requests.sql`.
   Always use the next free number.
2. **Never edit a migration after it has been committed.** Other machines have already run it.
   To change something, add a new migration (e.g. `005_add_priority_to_requests.sql`).
3. **One topic per file**, with a comment at the top saying which SRS items it supports.
4. Each file runs inside a transaction, so if any statement fails, nothing from that file is saved.
5. Every table that holds building data gets a `building_id` column (NFR-26).

## Useful commands

```bash
npm run db:migrate   # apply new migrations
npm run db:reset     # development only: drop everything and re-apply all migrations
```
