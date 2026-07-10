const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { ConfigStore } = require('./services/config-store.cjs');
const { UsageStore } = require('./services/usage-store.cjs');
const { discoverModels, streamChat } = require('./services/openai-client.cjs');
const { CODING_PLANS, getCodingPlan, normalizeCodingPlanModels, chooseCodingPlanModel } = require('./services/coding-plans.cjs');
const { getStatus, listExtensions, installPlugin, removePlugin, addMcp, removeMcp, runAgent } = require('./services/codex-cli-service.cjs');
const { searchWeb, buildSearchContext } = require('./services/web-search-service.cjs');

app.setName('codex-flow-desktop');

let mainWindow;
let configStore;
let usageStore;
const activeRequests = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f4f5f2',
    show: false,
    title: 'Codex Flow',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (String(url).startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

async function saveAndDiscoverProvider(payload) {
  if (!payload?.apiKey?.trim()) throw new Error('请输入 API Key。');
  const provider = {
    id: payload.id || 'openai-compatible',
    name: payload.name || 'OpenAI Compatible',
    baseUrl: payload.baseUrl || 'https://api.openai.com/v1',
    apiKey: payload.apiKey.trim()
  };
  let models = [];
  let discoveryError = null;
  try {
    models = await discoverModels(provider);
  } catch (error) {
    discoveryError = error;
  }
  const codingPlan = getCodingPlan(provider.baseUrl);
  if (codingPlan) models = normalizeCodingPlanModels(codingPlan, models);
  const manualModel = payload.model?.trim();
  if (!models.length && manualModel) models = [{ id: manualModel, ownedBy: 'manual' }];
  if (!models.length) {
    const reason = discoveryError?.message || '接口没有返回可用模型';
    throw new Error(reason + '。如果该接口不支持 /models，请填写模型 ID 后重试。');
  }
  const preferred = codingPlan
    ? chooseCodingPlanModel(codingPlan, models, manualModel)
    : manualModel && models.some(item => item.id === manualModel) ? manualModel : models[0].id;
  return configStore.saveProvider({ ...provider, model: preferred, models });
}

async function recordUsage({ requestId, provider, model, usage, estimated = false }) {
  const inputTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0);
  const totalTokens = Number(usage?.total_tokens ?? inputTokens + outputTokens);
  return usageStore.add({
    requestId,
    providerId: provider.id,
    modelId: model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimated,
    estimatedCost: 0,
    status: 'success',
    createdAt: new Date().toISOString()
  });
}

function registerIpc() {
  ipcMain.handle('config:get-public', () => configStore.publicConfig());
  ipcMain.handle('coding-plans:list', () => CODING_PLANS.map(plan => ({ id: plan.id, name: plan.name, baseUrl: plan.baseUrl, defaultModel: plan.defaultModel, models: plan.fallbackModels })));
  ipcMain.handle('provider:save-and-discover', (_event, payload) => saveAndDiscoverProvider(payload));
  ipcMain.handle('provider:discover', async () => {
    const provider = configStore.getProviderWithSecret();
    let models = await discoverModels(provider);
    const codingPlan = getCodingPlan(provider.baseUrl);
    if (codingPlan) models = normalizeCodingPlanModels(codingPlan, models);
    return configStore.updateModels(models, codingPlan ? chooseCodingPlanModel(codingPlan, models) : undefined);
  });
  ipcMain.handle('provider:set-model', async (_event, model) => {
    const publicConfig = configStore.publicConfig();
    return configStore.updateModels(publicConfig.provider?.models || [], model);
  });
  ipcMain.handle('usage:summary', (_event, range) => usageStore.summary(range));
  ipcMain.handle('usage:list', (_event, limit) => usageStore.list(limit));
  ipcMain.handle('codex:status', () => getStatus());
  ipcMain.handle('extensions:list', () => listExtensions());
  ipcMain.handle('extensions:install', (_event, pluginId) => installPlugin(pluginId));
  ipcMain.handle('extensions:remove', (_event, pluginId) => removePlugin(pluginId));
  ipcMain.handle('extensions:add-mcp', (_event, payload) => addMcp(payload));
  ipcMain.handle('extensions:remove-mcp', (_event, name) => removeMcp(name));
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '选择 Codex 工作区' });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('agent:start', async (event, payload) => {
    const provider = configStore.getProviderWithSecret();
    const requestId = payload.requestId || crypto.randomUUID();
    const model = payload.model || provider.model;
    const workspace = payload.workspace || process.cwd();
    activeRequests.set(requestId, { cancel: null });
    try {
      let agentPrompt = payload.prompt;
      let useNativeSearch = false;
      if (payload.webSearch !== false) {
        event.sender.send('agent:event', { requestId, type: 'tool', status: 'running', itemType: 'web_search', text: '正在搜索实时网络信息' });
        try {
          const searchResults = await searchWeb(payload.prompt);
          agentPrompt = buildSearchContext(payload.prompt, searchResults);
          event.sender.send('agent:event', { requestId, type: 'tool', status: 'completed', itemType: 'web_search', text: '已检索 ' + searchResults.length + ' 个网络来源' });
        } catch (searchError) {
          useNativeSearch = true;
          event.sender.send('agent:event', { requestId, type: 'tool', status: 'completed', itemType: 'web_search', text: '客户端搜索不可用，已切换 Codex 原生搜索' });
        }
      }
      const result = await runAgent({
        provider,
        model,
        prompt: agentPrompt,
        workspace,
        webSearch: useNativeSearch,
        onChild: child => {
          const request = activeRequests.get(requestId);
          if (request) request.cancel = () => child.kill();
        },
        onEvent: data => event.sender.send('agent:event', { requestId, ...data })
      });
      const record = await recordUsage({ requestId, provider, model, usage: result.usage });
      event.sender.send('agent:event', { requestId, type: 'usage', record });
      event.sender.send('agent:event', { requestId, type: 'done' });
      return { requestId, record, message: result.finalMessage };
    } catch (error) {
      event.sender.send('agent:event', { requestId, type: 'error', message: error.message });
      throw new Error(error.message);
    } finally {
      activeRequests.delete(requestId);
    }
  });
  ipcMain.handle('agent:cancel', (_event, requestId) => {
    const request = activeRequests.get(requestId);
    if (!request?.cancel) return false;
    request.cancel();
    return true;
  });

  ipcMain.handle('chat:start', async (event, payload) => {
    const provider = configStore.getProviderWithSecret();
    const requestId = payload.requestId || crypto.randomUUID();
    const controller = new AbortController();
    activeRequests.set(requestId, { cancel: () => controller.abort() });
    try {
      const result = await streamChat({
        provider,
        model: payload.model || provider.model,
        messages: payload.messages,
        signal: controller.signal,
        onEvent: data => event.sender.send('chat:event', { requestId, ...data })
      });
      const record = await recordUsage({ requestId, provider, model: payload.model || provider.model, usage: {
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        total_tokens: result.totalTokens
      }, estimated: result.estimated });
      event.sender.send('chat:event', { requestId, type: 'usage', record });
      event.sender.send('chat:event', { requestId, type: 'done' });
      return { requestId, record };
    } catch (error) {
      const message = error.name === 'AbortError' ? '请求已取消。' : error.message;
      event.sender.send('chat:event', { requestId, type: 'error', message });
      throw new Error(message);
    } finally {
      activeRequests.delete(requestId);
    }
  });
  ipcMain.handle('chat:cancel', (_event, requestId) => {
    const request = activeRequests.get(requestId);
    if (!request?.cancel) return false;
    request.cancel();
    return true;
  });
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath('userData'));
  usageStore = new UsageStore(app.getPath('userData'));
  await Promise.all([configStore.load(), usageStore.load()]);
  const currentConfig = configStore.publicConfig();
  const codingPlan = getCodingPlan(currentConfig.provider?.baseUrl);
  if (codingPlan) {
    const models = normalizeCodingPlanModels(codingPlan, currentConfig.provider.models || []);
    const currentModel = chooseCodingPlanModel(codingPlan, models, currentConfig.provider.model);
    await configStore.updateModels(models, currentModel);
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
