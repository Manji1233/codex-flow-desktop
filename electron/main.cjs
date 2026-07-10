const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const { ConfigStore } = require('./services/config-store.cjs');
const { UsageStore } = require('./services/usage-store.cjs');
const { discoverModels, streamChat } = require('./services/openai-client.cjs');
const { CODING_PLANS, getCodingPlan, normalizeCodingPlanModels, chooseCodingPlanModel } = require('./services/coding-plans.cjs');
const { getStatus, listExtensions, installPlugin, removePlugin, addMcp, removeMcp, runAgent } = require('./services/codex-cli-service.cjs');
const { searchWeb, buildSearchContext } = require('./services/web-search-service.cjs');
const { TaskStore } = require('./services/task-store.cjs');
const { ContentStore } = require('./services/content-store.cjs');

app.setName('codex-flow-desktop');

let mainWindow;
let configStore;
let usageStore;
let taskStore;
let contentStore;
let schedulerTimer;
const activeRequests = new Map();
let taskQueue = Promise.resolve();

function withTaskStore(operation, reload = true) {
  const next = taskQueue.then(async () => {
    if (reload) await taskStore.load();
    return operation();
  });
  taskQueue = next.catch(() => {});
  return next;
}

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


async function executeBackgroundTask(task) {
  const provider = configStore.getProviderWithSecret();
  const model = task.model || provider.model;
  let prompt = task.prompt;
  let nativeSearch = false;
  if (task.webSearch !== false) {
    try { prompt = buildSearchContext(task.prompt, await searchWeb(task.prompt)); } catch { nativeSearch = true; }
  }
  const result = await runAgent({ provider, model, prompt, workspace: task.workspace || process.cwd(), webSearch: nativeSearch, onEvent: () => {} });
  await recordUsage({ requestId: crypto.randomUUID(), provider, model, usage: result.usage });
  await contentStore.addSession({ title: task.name, prompt: task.prompt, response: result.finalMessage, model, source: 'schedule' });
  return result.finalMessage;
}

async function runTask(task) {
  await withTaskStore(() => taskStore.markRunning(task.id));
  mainWindow?.webContents.send('tasks:changed');
  try {
    const result = await executeBackgroundTask(task);
    await withTaskStore(() => taskStore.complete(task.id, 'success', result));
    if (Notification.isSupported()) new Notification({ title: task.name, body: '定时任务执行完成' }).show();
  } catch (error) {
    await withTaskStore(() => taskStore.complete(task.id, 'failed', error.message));
  }
  mainWindow?.webContents.send('tasks:changed');
}

async function checkScheduledTasks() {
  const dueTasks = await withTaskStore(() => taskStore.due());
  for (const task of dueTasks) runTask(task);
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
  ipcMain.handle('tasks:list', () => withTaskStore(() => taskStore.list()));
  ipcMain.handle('tasks:summary', () => withTaskStore(() => taskStore.summary()));
  ipcMain.handle('tasks:save', (_event, payload) => withTaskStore(() => taskStore.save(payload)));
  ipcMain.handle('tasks:toggle', (_event, id, enabled) => withTaskStore(() => taskStore.toggle(id, enabled)));
  ipcMain.handle('tasks:remove', (_event, id) => withTaskStore(() => taskStore.remove(id)));
  ipcMain.handle('tasks:run', async (_event, id) => { const task = await withTaskStore(() => taskStore.list().find(item => item.id === id)); if (!task) throw new Error('任务不存在。'); runTask(task); return true; });
  ipcMain.handle('history:list', (_event, limit) => contentStore.sessions(limit));
  ipcMain.handle('prompts:list', () => contentStore.prompts());
  ipcMain.handle('prompts:save', (_event, payload) => contentStore.savePrompt(payload));
  ipcMain.handle('prompts:remove', (_event, id) => contentStore.removePrompt(id));
  ipcMain.handle('conversation:export', async (_event, payload) => { const result = await dialog.showSaveDialog(mainWindow, { title: '导出对话', defaultPath: (payload.title || 'codex-flow-session') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (result.canceled) return null; await require('node:fs/promises').writeFile(result.filePath, payload.content, 'utf8'); return result.filePath; });
  ipcMain.handle('media:choose', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile','multiSelections'], filters: [{ name: '媒体文件', extensions: ['mp4','mov','mkv','mp3','wav','png','jpg','jpeg','webp'] }] }); return result.canceled ? [] : result.filePaths; });
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
      await contentStore.addSession({ title: payload.title || payload.prompt.slice(0, 40), prompt: payload.prompt, response: result.finalMessage, model, source: payload.source || 'chat' });
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
      const prompt = payload.messages?.filter(message => message.role === 'user').at(-1)?.content || '对话';
      await contentStore.addSession({ title: payload.title || prompt.slice(0, 40), prompt, response: result.output, model: payload.model || provider.model, source: payload.source || 'chat' });
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
  taskStore = new TaskStore(app.getPath('userData'));
  contentStore = new ContentStore(app.getPath('userData'));
  await Promise.all([configStore.load(), usageStore.load(), taskStore.load(), contentStore.load()]);
  const currentConfig = configStore.publicConfig();
  const codingPlan = getCodingPlan(currentConfig.provider?.baseUrl);
  if (codingPlan) {
    const models = normalizeCodingPlanModels(codingPlan, currentConfig.provider.models || []);
    const currentModel = chooseCodingPlanModel(codingPlan, models, currentConfig.provider.model);
    await configStore.updateModels(models, currentModel);
  }
  registerIpc();
  createWindow();
  schedulerTimer = setInterval(checkScheduledTasks, 15000);
  checkScheduledTasks();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => clearInterval(schedulerTimer));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
