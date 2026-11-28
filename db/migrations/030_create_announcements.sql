-- 030_create_announcements.sql
-- Announcements from the admin to residents (FR-23, FR-24).
-- Each active resident gets one notification per announcement; its read_at
-- records whether they have read it.
--
-- Numbered 030 so it does not clash with maintenance (002-019) or billing (020-029).

CREATE TABLE announcements (
  id           BIGSERIAL PRIMARY KEY,
  building_id  INT NOT NULL DEFAULT 1 REFERENCES buildings(id),                  -- NFR-26
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  category     TEXT NOT NULL CHECK (category IN ('service', 'maintenance', 'meeting', 'rules')),
  created_by   BIGINT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ                                                       -- NULL = never edited
);

CREATE INDEX announcements_recent_idx ON announcements (building_id, created_at DESC, id DESC);

-- A notification is about a request, an announcement, or neither.
-- Deleting an announcement removes its notifications.
ALTER TABLE notifications ADD COLUMN announcement_id BIGINT REFERENCES announcements(id) ON DELETE CASCADE;
CREATE INDEX notifications_announcement_idx ON notifications (announcement_id) WHERE announcement_id IS NOT NULL;
