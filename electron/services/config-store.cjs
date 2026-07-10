const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

class ConfigStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'codex-flow-config.json');
    this.state = { provider: null };
  }

  async load() {
    try {
      this.state = { ...this.state, ...JSON.parse(await fs.readFile(this.filePath, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this.publicConfig();
  }

  publicConfig() {
    const provider = this.state.provider;
    if (!provider) return { configured: false, provider: null };
    return {
      configured: Boolean(provider.encryptedApiKey),
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        model: provider.model || null,
        models: provider.models || [],
        updatedAt: provider.updatedAt
      }
    };
  }

  async saveProvider({ id, name, baseUrl, apiKey, model, models = [] }) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法使用安全密钥存储，请检查系统登录状态。');
    const parsedUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('API 地址只支持 HTTP 或 HTTPS。');
    let normalizedUrl = parsedUrl.toString();
    while (normalizedUrl.endsWith('/')) normalizedUrl = normalizedUrl.slice(0, -1);
    const encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64');
    this.state.provider = {
      id,
      name,
      baseUrl: normalizedUrl,
      model: model || models[0]?.id || null,
      models,
      encryptedApiKey,
      updatedAt: new Date().toISOString()
    };
    await this.persist();
    return this.publicConfig();
  }

  async updateModels(models, model) {
    if (!this.state.provider) throw new Error('尚未配置模型服务商。');
    this.state.provider.models = models;
    this.state.provider.model = model || this.state.provider.model || models[0]?.id || null;
    this.state.provider.updatedAt = new Date().toISOString();
    await this.persist();
    return this.publicConfig();
  }

  async clearProvider() {
    this.state.provider = null;
    await this.persist();
    return this.publicConfig();
  }

  getProviderWithSecret() {
    if (!this.state.provider?.encryptedApiKey) throw new Error('请先配置 API Key。');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用。');
    return {
      ...this.state.provider,
      apiKey: safeStorage.decryptString(Buffer.from(this.state.provider.encryptedApiKey, 'base64'))
    };
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}

module.exports = { ConfigStore };
