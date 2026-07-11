const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DataProtectionService } = require('../electron/services/data-protection-service.cjs');

test('client updates back up and restore history without exposing file contents', async t => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-flow-backup-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  await fs.writeFile(path.join(userDataPath, 'codex-flow-content.json'), JSON.stringify({ sessions: [{ id: 'history-1' }], prompts: [] }), 'utf8');
  await fs.writeFile(path.join(userDataPath, 'codex-flow-config.json'), JSON.stringify({ provider: { encryptedApiKey: 'encrypted-only' } }), 'utf8');
  const protection = new DataProtectionService(userDataPath, { appVersion: '0.3.0' });

  const baseline = await protection.protectVersion('0.3.0');
  assert.ok(baseline.files.includes('codex-flow-content.json'));
  assert.ok(baseline.files.includes('codex-flow-config.json'));
  assert.equal(baseline.path.includes(userDataPath), true);

  await fs.writeFile(path.join(userDataPath, 'codex-flow-content.json'), JSON.stringify({ sessions: [{ id: 'history-2' }], prompts: [] }), 'utf8');
  const updateBackup = await protection.createBackup('安装更新-0.3.0-to-0.4.0');
  await fs.writeFile(path.join(userDataPath, 'codex-flow-content.json'), JSON.stringify({ sessions: [], prompts: [] }), 'utf8');
  await protection.restoreBackup(updateBackup.id);

  const restored = JSON.parse(await fs.readFile(path.join(userDataPath, 'codex-flow-content.json'), 'utf8'));
  assert.equal(restored.sessions[0].id, 'history-2');
  assert.ok((await protection.listBackups()).length >= 3);
});

test('version protection only creates one baseline per client version', async t => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-flow-version-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  await fs.writeFile(path.join(userDataPath, 'codex-flow-content.json'), '{}', 'utf8');
  const protection = new DataProtectionService(userDataPath, { appVersion: '0.3.0' });
  await protection.protectVersion('0.3.0');
  await protection.protectVersion('0.3.0');
  assert.equal((await protection.listBackups()).length, 1);
});
