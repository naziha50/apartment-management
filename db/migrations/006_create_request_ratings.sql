-- 006_create_request_ratings.sql
-- The resident's rating of a closed request (FR-50, BR-26).
--
-- One rating per request, never changed: request_id is the primary key, so the
-- database itself refuses a second rating, even if two arrive at the same moment.
-- Who may rate, and until when, is checked by the server (state-machine.js).

CREATE TABLE request_ratings (
  request_id   BIGINT PRIMARY KEY REFERENCES maintenance_requests(id),
  building_id  INT NOT NULL DEFAULT 1 REFERENCES buildings(id),                    -- NFR-14
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),                   -- 1 = very poor … 5 = excellent
  comment      TEXT CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 500),
  rated_by     BIGINT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
