-- 010_link_requests_to_scheduled_tasks.sql
-- Requests created from a scheduled task (BR-25): which task and which due date they are for.
-- Their deadline is that due date, not the BR-17 target (otherwise they would be overdue
-- before the job was even due).

ALTER TABLE maintenance_requests
  ADD COLUMN scheduled_task_id BIGINT REFERENCES scheduled_tasks(id),
  ADD COLUMN due_date          DATE,                                    -- a calendar day
  ADD CHECK ((scheduled_task_id IS NULL) = (due_date IS NULL));

-- One request per task per due date, even if two server processes create them at the same moment.
CREATE UNIQUE INDEX maintenance_requests_task_due_uq
  ON maintenance_requests (scheduled_task_id, due_date) WHERE scheduled_task_id IS NOT NULL;
