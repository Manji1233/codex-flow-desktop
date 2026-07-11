function releaseNotesText(value) {
  if (typeof value === 'string') return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(item => item.note || '').filter(Boolean).join('\n');
  return '';
}

function updateErrorSummary(error) {
  const raw = String(error?.message || error || '未知更新错误');
  if (/404[\s\S]*releases(?:\.atom|\/latest)|releases(?:\.atom|\/latest)[\s\S]*404/i.test(raw)) {
    return { noRelease: true, message: '仓库尚未发布安装版；完成首次版本标签发布后即可启用自动更新。' };
  }
  const message = raw
    .split(/\nHeaders:/i)[0]
    .replace(/https?:\/\/\S+/g, '[更新源]')
    .replace(/(?:cookie|token|authorization)[^\n]*/gi, '[敏感响应信息已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  return { noRelease: false, message: message || '未知更新错误' };
}

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(part => Number(part) || 0);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

class UpdateService {
  constructor({ app, autoUpdater, dataProtection, onChange, fetchImpl = fetch } = {}) {
    this.app = app;
    this.autoUpdater = autoUpdater;
    this.dataProtection = dataProtection;
    this.onChange = onChange || (() => {});
    this.fetchImpl = fetchImpl;
    this.releaseApiUrl = 'https://api.github.com/repos/Manji1233/codex-flow-desktop/releases/latest';
    this.releaseDownloadRoot = 'https://github.com/Manji1233/codex-flow-desktop/releases/download';
    this.initialized = false;
    this.handlers = [];
    this.state = {
      supported: Boolean(app?.isPackaged),
      currentVersion: app?.getVersion?.() || '0.0.0',
      phase: 'idle',
      availableVersion: null,
      releaseName: null,
      releaseNotes: '',
      progress: 0,
      transferred: 0,
      total: 0,
      message: app?.isPackaged ? '等待检查更新' : '开发模式不执行自动安装，打包版本将启用更新',
      error: null,
      downloaded: false,
      historyProtected: true,
      latestBackup: null
    };
  }

  initialize() {
    if (this.initialized) return this.snapshot();
    this.initialized = true;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowPrerelease = false;
    this.bind('checking-for-update', () => this.update({ phase: 'checking', message: '正在检查客户端更新', error: null }));
    this.bind('update-available', info => this.update({
      phase: 'available',
      availableVersion: info.version,
      releaseName: info.releaseName || null,
      releaseNotes: releaseNotesText(info.releaseNotes) || this.state.releaseNotes,
      message: '发现新版本 ' + info.version,
      error: null
    }));
    this.bind('update-not-available', info => this.update({
      phase: 'current',
      availableVersion: info?.version || this.state.currentVersion,
      progress: 0,
      message: '当前客户端已是最新版本',
      error: null
    }));
    this.bind('download-progress', progress => this.update({
      phase: 'downloading',
      progress: Math.max(0, Math.min(100, Number(progress.percent || 0))),
      transferred: Number(progress.transferred || 0),
      total: Number(progress.total || 0),
      message: '正在下载更新 ' + Math.round(Number(progress.percent || 0)) + '%'
    }));
    this.bind('update-downloaded', info => this.update({
      phase: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      downloaded: true,
      message: '更新已下载，安装前将再次备份历史记录',
      error: null
    }));
    this.bind('error', error => {
      const summary = updateErrorSummary(error);
      this.update(summary.noRelease
        ? { phase: 'unpublished', message: summary.message, error: null }
        : { phase: 'error', message: '更新失败', error: summary.message });
    });
    return this.snapshot();
  }

  async check() {
    this.initialize();
    if (!this.state.supported) return this.update({ phase: 'unsupported', message: '开发模式不执行自动更新，请使用打包安装版' });
    this.update({ phase: 'checking', message: '正在检查客户端更新', error: null });
    try {
      const response = await this.fetchImpl(this.releaseApiUrl, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ChatGPT-Codex-Updater' },
        signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404) return this.update({ phase: 'unpublished', message: '仓库尚未发布安装版；完成首次版本标签发布后即可启用自动更新。', error: null });
      if (!response.ok) throw new Error('GitHub API HTTP ' + response.status);
      const release = await response.json();
      const tag = String(release.tag_name || '');
      const availableVersion = tag.replace(/^v/i, '');
      if (!availableVersion) throw new Error('GitHub Release 没有有效版本号。');
      if (compareVersions(availableVersion, this.state.currentVersion) <= 0) {
        return this.update({ phase: 'current', availableVersion, releaseName: release.name || tag, releaseNotes: releaseNotesText(release.body), message: '当前客户端已是最新版本', error: null });
      }
      if (!/^[0-9A-Za-z._-]+$/.test(tag)) throw new Error('GitHub Release 标签格式无效。');
      this.autoUpdater.setFeedURL({ provider: 'generic', url: this.releaseDownloadRoot + '/' + encodeURIComponent(tag) });
      this.update({ phase: 'available', availableVersion, releaseName: release.name || tag, releaseNotes: releaseNotesText(release.body), message: '发现新版本 ' + availableVersion, error: null });
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      const summary = updateErrorSummary(error);
      return this.update(summary.noRelease
        ? { phase: 'unpublished', message: summary.message, error: null }
        : { phase: 'error', message: '更新失败', error: summary.message });
    }
    return this.snapshot();
  }

  async download() {
    if (!this.state.supported) return this.update({ phase: 'unsupported', message: '开发模式无法下载更新' });
    if (!this.state.availableVersion) throw new Error('当前没有可下载的更新。');
    this.update({ phase: 'downloading', progress: 0, message: '正在准备下载更新', error: null });
    await this.autoUpdater.downloadUpdate();
    return this.snapshot();
  }

  async install() {
    if (!this.state.downloaded) throw new Error('更新尚未下载完成。');
    const backup = await this.dataProtection.createBackup('安装更新-' + this.state.currentVersion + '-to-' + this.state.availableVersion);
    this.update({ phase: 'installing', latestBackup: backup, message: '历史记录已备份，正在重启安装' });
    setImmediate(() => this.autoUpdater.quitAndInstall(false, true));
    return this.snapshot();
  }

  async refreshBackups() {
    const backups = await this.dataProtection.listBackups();
    return this.update({ latestBackup: backups[0] || null });
  }

  snapshot() {
    return { ...this.state };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    this.onChange(snapshot);
    return snapshot;
  }

  bind(event, handler) {
    this.autoUpdater.on(event, handler);
    this.handlers.push([event, handler]);
  }

  dispose() {
    for (const [event, handler] of this.handlers) this.autoUpdater.removeListener(event, handler);
    this.handlers = [];
    this.initialized = false;
  }
}

module.exports = { UpdateService, releaseNotesText, updateErrorSummary, compareVersions };
