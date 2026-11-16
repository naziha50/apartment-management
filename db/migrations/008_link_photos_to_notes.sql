-- 008_link_photos_to_notes.sql
-- Photos on progress notes (BR-19, FR-20).
--
-- update_id says which history entry (note) a photo came with. NULL means the
-- photo was attached when the request was reported, as before. A photo on an
-- internal note is as private as the note: residents never receive it.

ALTER TABLE request_attachments ADD COLUMN update_id BIGINT REFERENCES request_updates(id);
