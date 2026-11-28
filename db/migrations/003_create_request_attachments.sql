-- 003_create_request_attachments.sql
-- Photos attached to maintenance requests (BR-19, FR-16, SI-03).
--
-- Only the photo's details are stored here; the file itself lives on disk under
-- UPLOAD_DIR with a random name (see server/modules/maintenance/uploads.js).
-- The limit of 3 photos per request is checked by the server.

CREATE TABLE request_attachments (
  id             BIGSERIAL PRIMARY KEY,
  building_id    INT NOT NULL DEFAULT 1 REFERENCES buildings(id),                  -- NFR-14
  request_id     BIGINT NOT NULL REFERENCES maintenance_requests(id),
  stored_name    TEXT NOT NULL UNIQUE,                                              -- random name on disk
  original_name  TEXT NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 200),
  mime_type      TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes     INT  NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),   -- 5 MB
  uploaded_by    BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX request_attachments_request_idx ON request_attachments (request_id);
