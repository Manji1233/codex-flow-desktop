const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateService, releaseNotesText, updateErrorSummary } = require('../electron/services/update-service.cjs');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.feed = null;
  }

  setFeedURL(feed) {
    this.feed = feed;
  }

  async checkForUpdates() {
    this.checkCalls += 1;
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.4.0', releaseName: '0.4.0', releaseNotes: '<b>新增更新中心</b>' });
  }

  async downloadUpdate() {
    this.emit('download-progress', { percent: 48, transferred: 48, total: 100 });
    this.emit('update-downloaded', { version: '0.4.0' });
  }

  quitAndInstall() { this.installed = true; }
}

test('packaged updater checks, downloads, backs up and installs', async () => {
  const updater = new FakeUpdater();
  const backups = [];
  const protection = {
    async createBackup(reason) { const backup = { id: 'backup-1', reason, createdAt: new Date().toISOString() }; backups.push(backup); return backup; },
    async listBackups() { return backups; }
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v0.4.0', name: 'ChatGPT Codex 0.4.0', body: '更新说明' })
  });
  const service = new UpdateService({ app: { isPackaged: true, getVersion: () => '0.3.0' }, autoUpdater: updater, dataProtection: protection, fetchImpl });
  service.initialize();
  await service.check();
  assert.equal(service.snapshot().phase, 'available');
  assert.equal(service.snapshot().releaseNotes, '新增更新中心');
  assert.deepEqual(updater.feed, {
    provider: 'generic',
    url: 'https://github.com/Manji1233/codex-flow-desktop/releases/download/v0.4.0'
  });
  assert.equal(updater.checkCalls, 1);
  await service.download();
  assert.equal(service.snapshot().downloaded, true);
  await service.install();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(backups[0].reason, '安装更新-0.3.0-to-0.4.0');
  assert.equal(updater.installed, true);
});

test('current packaged version skips the updater feed request', async () => {
  const updater = new FakeUpdater();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v0.4.0', name: 'ChatGPT Codex 0.4.0', body: '更新说明' })
  });
  const service = new UpdateService({
    app: { isPackaged: true, getVersion: () => '0.4.0' },
    autoUpdater: updater,
    dataProtection: { listBackups: async () => [] },
    fetchImpl
  });
  assert.equal((await service.check()).phase, 'current');
  assert.equal(service.snapshot().releaseNotes, '更新说明');
  assert.equal(updater.feed, null);
  assert.equal(updater.checkCalls, 0);
});

test('development builds report updates as unsupported', async () => {
  const service = new UpdateService({ app: { isPackaged: false, getVersion: () => '0.3.0' }, autoUpdater: new FakeUpdater(), dataProtection: { listBackups: async () => [] } });
  assert.equal((await service.check()).phase, 'unsupported');
});

test('release notes are converted to safe plain text', () => {
  assert.equal(releaseNotesText('<h1>更新</h1><p>保留历史</p>'), '更新 保留历史');
});

test('missing releases and sensitive response headers are sanitized', () => {
  const missing = updateErrorSummary(new Error('404 GET https://github.com/demo/releases.atom\nHeaders: {"set-cookie":"secret"}'));
  assert.equal(missing.noRelease, true);
  assert.equal(missing.message.includes('首次'), true);
  const failed = updateErrorSummary(new Error('500 GET https://example.com/latest.yml\nHeaders: {"authorization":"secret"}'));
  assert.equal(failed.noRelease, false);
  assert.equal(failed.message.includes('secret'), false);
  assert.equal(failed.message.includes('https://'), false);
});
