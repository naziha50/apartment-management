'use strict';
/** Photo storage (BR-19): files are saved all together or not at all. Run with `npm test`. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// config.js reads UPLOAD_DIR when it is first loaded, so point it at a temporary folder first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-uploads-test-'));
process.env.UPLOAD_DIR = dir;
const { inspectFiles, saveFiles } = require('../server/modules/maintenance/uploads');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const photo = (name) => ({ originalname: name, buffer: PNG, size: PNG.length });

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('saves every photo under a random name', async () => {
  const saved = await saveFiles(inspectFiles([photo('a.png'), photo('b.png')]));
  assert.equal(saved.length, 2);
  for (const s of saved) assert.match(s.storedName, /^[a-f0-9-]{36}\.png$/);
  assert.equal(fs.readdirSync(dir).length, 2);
  for (const s of saved) fs.unlinkSync(path.join(dir, s.storedName));
});

test('when one photo cannot be written, the ones already written are removed', async () => {
  const files = inspectFiles([photo('a.png'), photo('b.png')]);
  files[1].buffer = undefined; // makes the 2nd write fail, like a full disk would
  await assert.rejects(saveFiles(files));
  assert.deepEqual(fs.readdirSync(dir), [], 'no orphan files left on disk');
});
