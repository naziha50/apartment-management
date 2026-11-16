-- 007_create_notifications.sql
-- In-app notifications (FR-25): "your request is now In progress", "you were assigned …".
--
-- Each row is one message for one person. The maintenance service writes them in the
-- same transaction as the change they describe, so a change is never saved without its
-- notification, or the other way round.

CREATE TABLE notifications (
  id           BIGSERIAL PRIMARY KEY,
  building_id  INT NOT NULL DEFAULT 1 REFERENCES buildings(id),                   -- NFR-26
  user_id      BIGINT NOT NULL REFERENCES users(id),                             -- who it is for
  request_id   BIGINT REFERENCES maintenance_requests(id),                       -- what it is about (opens on click)
  message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 300),
  read_at      TIMESTAMPTZ,                                                      -- NULL = unread
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "My newest notifications" (the list) and "how many unread" (the bell) both start from the user.
CREATE INDEX notifications_user_recent_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
