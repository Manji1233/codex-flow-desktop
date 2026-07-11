const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_FILES = [
  'codex-flow-config.json',
  'codex-flow-usage.json',
  'codex-flow-tasks.json',
  'codex-flow-content.json'
];

function backupId(reason) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = String(reason || 'manual').replace(/[^0-9A-Za-z\u4e00-\u9fff_-]+/g, '-').slice(0, 60);
  return timestamp + '-' + suffix;
}

class DataProtectionService {
  constructor(userDataPath, { appVersion = '0.0.0', retention = 12 } = {}) {
    this.userDataPath = userDataPath;
    this.backupRoot = path.join(userDataPath, 'backups');
    this.versionMarkerPath = path.join(userDataPath, 'codex-flow-version.json');
    this.appVersion = appVersion;
    this.retention = retention;
  }

  async protectVersion(currentVersion = this.appVersion) {
    const marker = await this.readJson(this.versionMarkerPath, null);
    const existingFiles = await this.existingDataFiles();
    let backup = null;
    if (existingFiles.length && marker?.version !== currentVersion) {
      const reason = marker?.version ? '升级前-' + marker.version + '-to-' + currentVersion : '启用更新保护-' + currentVersion;
      backup = await this.createBackup(reason);
    }
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.writeFile(this.versionMarkerPath, JSON.stringify({ version: currentVersion, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    this.appVersion = currentVersion;
    return backup;
  }

  async createBackup(reason = 'manual', { prune = true } = {}) {
    const files = await this.existingDataFiles();
    if (!files.length) return null;
    const id = backupId(reason);
    const directory = path.join(this.backupRoot, id);
    await fs.mkdir(directory, { recursive: true });
    for (const file of files) await fs.copyFile(path.join(this.userDataPath, file), path.join(directory, file));
    const manifest = {
      id,
      reason,
      appVersion: this.appVersion,
      createdAt: new Date().toISOString(),
      files
    };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    if (prune) await this.prune();
    return { ...manifest, path: directory };
  }

  async listBackups() {
    let entries = [];
    try { entries = await fs.readdir(this.backupRoot, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const backups = [];
    for (const entry of entries.filter(item => item.isDirectory())) {
      const directory = path.join(this.backupRoot, entry.name);
      const manifest = await this.readJson(path.join(directory, 'manifest.json'), null);
      if (manifest) backups.push({ ...manifest, path: directory });
    }
    return backups.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async restoreBackup(id) {
    if (!id || path.basename(id) !== id) throw new Error('备份 ID 无效。');
    const directory = path.resolve(this.backupRoot, id);
    const root = path.resolve(this.backupRoot) + path.sep;
    if (!directory.startsWith(root)) throw new Error('备份路径越界。');
    const manifest = await this.readJson(path.join(directory, 'manifest.json'), null);
    if (!manifest) throw new Error('备份不存在或已损坏。');
    await this.createBackup('恢复前自动保护', { prune: false });
    for (const file of manifest.files || []) {
      if (!DATA_FILES.includes(file)) continue;
      await fs.copyFile(path.join(directory, file), path.join(this.userDataPath, file));
    }
    await this.prune();
    return { ...manifest, restoredAt: new Date().toISOString() };
  }

  async existingDataFiles() {
    const files = [];
    for (const file of DATA_FILES) {
      try { if ((await fs.stat(path.join(this.userDataPath, file))).isFile()) files.push(file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return files;
  }

  async prune() {
    const backups = await this.listBackups();
    for (const backup of backups.slice(this.retention)) await fs.rm(backup.path, { recursive: true, force: true });
  }

  async readJson(filePath, fallback) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
  }
}

module.exports = { DataProtectionService, DATA_FILES, backupId };
