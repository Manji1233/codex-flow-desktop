const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const RECOMMENDED_VIDEO_PLUGINS = Object.freeze([
  {
    id: 'remotion@openai-api-curated',
    name: 'Remotion',
    rank: 1,
    description: '程序化剪辑、动效、字幕、图表和 React 视频合成。'
  },
  {
    id: 'hyperframes@openai-api-curated',
    name: 'HyperFrames by HeyGen',
    rank: 2,
    description: 'HTML、GSAP、网页转视频、配音和音频响应视觉。'
  }
]);

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

class VideoSkillService {
  constructor({ sourceRoot, codexHome = defaultCodexHome(), listExtensions, installPlugin, onChange } = {}) {
    this.sourceRoot = sourceRoot;
    this.codexHome = codexHome;
    this.listExtensions = listExtensions;
    this.installPlugin = installPlugin;
    this.onChange = onChange || (() => {});
    this.ensurePromise = null;
    this.state = {
      phase: 'idle',
      message: '等待准备视频 Skills',
      bundledSkill: { name: 'video-studio', installed: false },
      plugins: RECOMMENDED_VIDEO_PLUGINS.map(plugin => ({ ...plugin, installed: false, status: 'pending', error: null }))
    };
  }

  async prepareBundledSkill() {
    this.update({ phase: 'preparing', message: '正在安装内置视频编排 Skill' });
    const source = path.join(this.sourceRoot, 'video-studio');
    const destination = path.join(this.codexHome, 'skills', 'video-studio');
    await fs.access(path.join(source, 'SKILL.md'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true, force: true });
    this.update({ bundledSkill: { name: 'video-studio', installed: true } });
    return this.snapshot();
  }

  async ensure() {
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.runEnsure().finally(() => { this.ensurePromise = null; });
    return this.ensurePromise;
  }

  async runEnsure() {
    try {
      if (!this.state.bundledSkill.installed) await this.prepareBundledSkill();
    } catch (error) {
      return this.update({ phase: 'error', message: '内置视频 Skill 安装失败', error: error.message });
    }

    this.update({ phase: 'installing', message: '正在安装官方精选视频插件', error: null });
    let available = [];
    try {
      available = (await this.listExtensions()).plugins || [];
    } catch (error) {
      return this.update({
        phase: 'partial',
        message: '离线视频 Skill 已可用，官方插件将在网络恢复后重试',
        error: error.message
      });
    }

    let plugins = [];
    for (const recommendation of RECOMMENDED_VIDEO_PLUGINS) {
      const existing = available.find(plugin => plugin.id === recommendation.id);
      if (existing?.installed) {
        plugins.push({ ...recommendation, installed: true, status: 'ready', error: null, iconDataUrl: existing.iconDataUrl || '', brandColor: existing.brandColor || '' });
        continue;
      }
      try {
        await this.installPlugin(recommendation.id);
        plugins.push({ ...recommendation, installed: true, status: 'ready', error: null, iconDataUrl: existing?.iconDataUrl || '', brandColor: existing?.brandColor || '' });
      } catch (error) {
        plugins.push({ ...recommendation, installed: false, status: 'failed', error: error.message, iconDataUrl: existing?.iconDataUrl || '', brandColor: existing?.brandColor || '' });
      }
      this.update({ plugins: [...plugins, ...RECOMMENDED_VIDEO_PLUGINS.slice(plugins.length).map(plugin => ({ ...plugin, installed: false, status: 'pending', error: null }))] });
    }

    try {
      const refreshed = (await this.listExtensions()).plugins || [];
      plugins = plugins.map(plugin => {
        const current = refreshed.find(item => item.id === plugin.id);
        if (!current) return plugin;
        return {
          ...plugin,
          installed: Boolean(current.installed) || plugin.installed,
          status: current.installed || plugin.installed ? 'ready' : plugin.status,
          iconDataUrl: current.iconDataUrl || plugin.iconDataUrl || '',
          brandColor: current.brandColor || plugin.brandColor || ''
        };
      });
    } catch {}

    const allReady = plugins.every(plugin => plugin.installed);
    return this.update({
      phase: allReady ? 'ready' : 'partial',
      message: allReady ? '热门视频 Skills 已内置并启用' : '离线视频 Skill 已可用，部分官方插件安装失败',
      plugins,
      error: allReady ? null : plugins.filter(plugin => plugin.error).map(plugin => plugin.name + '：' + plugin.error).join('\n')
    });
  }

  snapshot() {
    return {
      ...this.state,
      bundledSkill: { ...this.state.bundledSkill },
      plugins: this.state.plugins.map(plugin => ({ ...plugin }))
    };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    this.onChange(snapshot);
    return snapshot;
  }
}

module.exports = { VideoSkillService, RECOMMENDED_VIDEO_PLUGINS, defaultCodexHome };
