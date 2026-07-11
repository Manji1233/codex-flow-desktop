const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

class ConfigStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'codex-flow-config.json');
    this.state = { authMode: null, provider: null, chatgpt: null };
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
    const savedProvider = this.publicProvider(this.state.provider);
    const modes = {
      apiKey: Boolean(this.state.provider?.encryptedApiKey),
      chatgpt: Boolean(this.state.chatgpt?.account)
    };
    if (this.state.authMode === 'chatgpt' && modes.chatgpt) {
      return {
        configured: true,
        authMode: 'chatgpt',
        availableModes: modes,
        account: this.state.chatgpt.account,
        chatgptAccount: this.state.chatgpt.account,
        savedProvider,
        provider: {
          id: 'chatgpt-codex',
          name: 'ChatGPT Codex',
          baseUrl: null,
          model: this.state.chatgpt.model || null,
          models: this.state.chatgpt.models || [],
          updatedAt: this.state.chatgpt.updatedAt
        }
      };
    }
    const provider = this.state.provider;
    if (!provider) return { configured: false, authMode: null, availableModes: modes, account: null, chatgptAccount: this.state.chatgpt?.account || null, savedProvider: null, provider: null };
    return {
      configured: Boolean(provider.encryptedApiKey),
      authMode: 'apiKey',
      availableModes: modes,
      account: null,
      chatgptAccount: this.state.chatgpt?.account || null,
      savedProvider,
      provider: savedProvider
    };
  }

  publicProvider(provider) {
    if (!provider) return null;
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model || null,
      models: provider.models || [],
      updatedAt: provider.updatedAt
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
    this.state.authMode = 'apiKey';
    await this.persist();
    return this.publicConfig();
  }

  async saveChatGptAccount({ account, model, models = [] }) {
    this.state.chatgpt = {
      account,
      model: model || models.find(item => item.isDefault)?.id || models[0]?.id || null,
      models,
      updatedAt: new Date().toISOString()
    };
    this.state.authMode = 'chatgpt';
    await this.persist();
    return this.publicConfig();
  }

  async activateMode(mode) {
    if (mode === 'apiKey' && !this.state.provider?.encryptedApiKey) throw new Error('还没有保存 API Key 配置。');
    if (mode === 'chatgpt' && !this.state.chatgpt?.account) throw new Error('还没有登录 ChatGPT 账户。');
    this.state.authMode = mode;
    await this.persist();
    return this.publicConfig();
  }

  async updateModels(models, model) {
    const target = this.state.authMode === 'chatgpt' ? this.state.chatgpt : this.state.provider;
    if (!target) throw new Error('尚未配置模型服务商。');
    target.models = models;
    target.model = model || target.model || models.find(item => item.isDefault)?.id || models[0]?.id || null;
    target.updatedAt = new Date().toISOString();
    await this.persist();
    return this.publicConfig();
  }

  async clearChatGptAccount() {
    this.state.chatgpt = null;
    this.state.authMode = this.state.provider?.encryptedApiKey ? 'apiKey' : null;
    await this.persist();
    return this.publicConfig();
  }

  async clearProvider() {
    this.state.authMode = null;
    this.state.provider = null;
    this.state.chatgpt = null;
    await this.persist();
    return this.publicConfig();
  }

  getProviderWithSecret() {
    if (this.state.authMode === 'chatgpt' && this.state.chatgpt?.account) {
      return {
        id: 'chatgpt-codex',
        name: 'ChatGPT Codex',
        authMode: 'chatgpt',
        model: this.state.chatgpt.model || null,
        models: this.state.chatgpt.models || [],
        account: this.state.chatgpt.account
      };
    }
    if (!this.state.provider?.encryptedApiKey) throw new Error('请先配置 API Key。');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用。');
    return {
      ...this.state.provider,
      authMode: 'apiKey',
      apiKey: safeStorage.decryptString(Buffer.from(this.state.provider.encryptedApiKey, 'base64'))
    };
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}

module.exports = { ConfigStore };
