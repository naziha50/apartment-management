'use strict';
/**
 * Photo uploads for maintenance requests (BR-19, SI-03).
 *  - At most 3 photos, 5 MB each.
 *  - The real file type is read from the file's first bytes. The file name and
 *    the type the browser reports are not trusted, so a renamed .exe is rejected.
 *  - Files are saved under random names outside /public and are only ever
 *    sent back as images to people who may see the request.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../../config');
const { badRequest } = require('../../lib/errors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: config.uploads.maxFiles, fields: 20 },
});

/** Express middleware: reads up to 3 files from the `photos` field, with plain-language errors. */
function photosField(req, res, next) {
  upload.array('photos', config.uploads.maxFiles)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('A photo is too large.', { photos: 'Each photo must be 5 MB or smaller.' }));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(badRequest('Too many photos.', { photos: `You can attach up to ${config.uploads.maxFiles} photos.` }));
    }
    // Files are kept in memory, so anything else here is a bad form from the browser
    // (too many fields, a broken or cut-off upload), not a server fault.
    return next(badRequest('The form could not be read. Please try sending it again.'));
  });
}

/** Recognises JPG, PNG and WEBP by their first bytes ("magic numbers"). */
function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Checks every file before anything is written; throws a field error for the first bad one. */
function inspectFiles(files = []) {
  return files.map((f) => {
    const type = sniffImageType(f.buffer);
    if (!type) throw badRequest('That file type is not allowed.', { photos: `"${f.originalname}" is not a JPG, PNG or WEBP photo.` });
    return { ...type, buffer: f.buffer, size: f.size, originalName: String(f.originalname).slice(0, 200) || 'photo' };
  });
}

/** Writes checked files to disk under random names; returns what to store in the database. */
async function saveFiles(inspected) {
  await fs.mkdir(config.uploads.dir, { recursive: true });
  const saved = [];
  try {
    for (const f of inspected) {
      const storedName = `${crypto.randomUUID()}.${f.ext}`;
      await fs.writeFile(path.join(config.uploads.dir, storedName), f.buffer, { flag: 'wx' });
      saved.push({ storedName, originalName: f.originalName, mime: f.mime, size: f.size });
    }
  } catch (err) {
    await removeFiles(saved); // e.g. disk full on the 2nd photo: do not leave the 1st behind
    throw err;
  }
  return saved;
}

/** Deletes files again when the database save that refers to them fails. */
async function removeFiles(saved) {
  await Promise.all(saved.map((s) => fs.unlink(path.join(config.uploads.dir, s.storedName)).catch(() => {})));
}

/** Full path of a stored photo. Stored names are ours, but anything path-like is still refused. */
function filePath(storedName) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(storedName)) return null;
  return path.join(config.uploads.dir, storedName);
}

module.exports = { photosField, inspectFiles, saveFiles, removeFiles, filePath };
