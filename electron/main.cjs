const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const { ConfigStore } = require('./services/config-store.cjs');
const { UsageStore } = require('./services/usage-store.cjs');
const { discoverModels, streamChat } = require('./services/openai-client.cjs');
const { CODING_PLANS, getCodingPlan, normalizeCodingPlanModels, chooseCodingPlanModel } = require('./services/coding-plans.cjs');
const { getStatus, listExtensions, installPlugin, removePlugin, addMcp, removeMcp, runAgent } = require('./services/codex-cli-service.cjs');
const { searchWeb, buildSearchContext, WEB_SEARCH_DEVELOPER_INSTRUCTIONS } = require('./services/web-search-service.cjs');
const { TaskStore } = require('./services/task-store.cjs');
const { ContentStore } = require('./services/content-store.cjs');
const { AppServerService } = require('./services/app-server-service.cjs');

app.setName('codex-flow-desktop');

let mainWindow;
let configStore;
let usageStore;
let taskStore;
let contentStore;
let appServer;
let schedulerTimer;
const activeRequests = new Map();
const appServerUsage = new Map();
let taskQueue = Promise.resolve();

function withTaskStore(operation, reload = true) {
  const next = taskQueue.then(async () => {
    if (reload) await taskStore.load();
    return operation();
  });
  taskQueue = next.catch(() => {});
  return next;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function ensureAppServer() {
  const provider = configStore.getProviderWithSecret();
  await appServer.ensure(provider);
  return provider;
}

function interactiveThreadConfig(payload, provider) {
  return {
    model: payload.model || provider.model,
    modelProvider: 'codex_flow',
    cwd: payload.workspace || process.cwd(),
    runtimeWorkspaceRoots: payload.workspace ? [payload.workspace] : null,
    approvalPolicy: payload.approvalPolicy || 'on-request',
    sandbox: payload.sandbox || 'workspace-write',
    developerInstructions: WEB_SEARCH_DEVELOPER_INSTRUCTIONS
  };
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
  ipcMain.handle('images:choose', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile','multiSelections'], filters: [{ name: '图片', extensions: ['png','jpg','jpeg','webp','gif'] }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('app-server:status', async () => { try { await ensureAppServer(); return { available: true }; } catch (error) { return { available: false, error: error.message }; } });
  ipcMain.handle('app-server:thread-list', async (_event, payload = {}) => {
    await ensureAppServer();
    return appServer.request('thread/list', {
      limit: payload.limit || 50,
      archived: Boolean(payload.archived),
      searchTerm: payload.searchTerm || null,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']
    });
  });
  ipcMain.handle('app-server:thread-read', async (_event, threadId) => { await ensureAppServer(); return appServer.request('thread/read', { threadId, includeTurns: true }); });
  ipcMain.handle('app-server:thread-start', async (_event, payload) => { const provider = await ensureAppServer(); return appServer.request('thread/start', { ...interactiveThreadConfig(payload, provider), ephemeral: false, historyMode: 'legacy' }); });
  ipcMain.handle('app-server:thread-resume', async (_event, payload) => { const provider = await ensureAppServer(); return appServer.request('thread/resume', { threadId: payload.threadId, ...interactiveThreadConfig(payload, provider) }); });
  ipcMain.handle('app-server:thread-fork', async (_event, payload) => { const provider = await ensureAppServer(); return appServer.request('thread/fork', { threadId: payload.threadId, lastTurnId: payload.lastTurnId || null, ...interactiveThreadConfig(payload, provider) }); });
  ipcMain.handle('app-server:thread-archive', async (_event, threadId) => { await ensureAppServer(); return appServer.request('thread/archive', { threadId }); });
  ipcMain.handle('app-server:thread-unarchive', async (_event, threadId) => { await ensureAppServer(); return appServer.request('thread/unarchive', { threadId }); });
  ipcMain.handle('app-server:thread-delete', async (_event, threadId) => { await ensureAppServer(); return appServer.request('thread/delete', { threadId }); });
  ipcMain.handle('app-server:thread-name-set', async (_event, payload) => { await ensureAppServer(); return appServer.request('thread/name/set', { threadId: payload.threadId, name: payload.name }); });
  ipcMain.handle('app-server:thread-compact', async (_event, threadId) => { await ensureAppServer(); return appServer.request('thread/compact/start', { threadId }); });
  ipcMain.handle('app-server:review-start', async (_event, payload) => { await ensureAppServer(); return appServer.request('review/start', { threadId: payload.threadId, target: payload.target || { type: 'uncommittedChanges' }, delivery: payload.delivery || 'inline' }); });
  ipcMain.handle('app-server:terminal-start', async (_event, payload = {}) => {
    await ensureAppServer();
    const processId = payload.processId || crypto.randomUUID();
    appServer.request('command/exec', {
      command: payload.command || ['powershell.exe', '-NoLogo'],
      cwd: payload.cwd || process.cwd(),
      processId,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      disableTimeout: true,
      disableOutputCap: true,
      size: payload.size || { cols: 110, rows: 30 },
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [payload.cwd || process.cwd()], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
    }).then(result => sendToRenderer('app-server:event', { method: 'codex-flow/terminal-exit', params: { processId, result } }))
      .catch(error => sendToRenderer('app-server:event', { method: 'codex-flow/terminal-exit', params: { processId, error: error.message } }));
    return { processId };
  });
  ipcMain.handle('app-server:terminal-write', async (_event, payload) => { await ensureAppServer(); return appServer.request('command/exec/write', payload); });
  ipcMain.handle('app-server:terminal-resize', async (_event, payload) => { await ensureAppServer(); return appServer.request('command/exec/resize', payload); });
  ipcMain.handle('app-server:terminal-terminate', async (_event, processId) => { await ensureAppServer(); return appServer.request('command/exec/terminate', { processId }); });
  ipcMain.handle('app-server:turn-start', async (_event, payload) => {
    await ensureAppServer();
    const input = [...(payload.input || [])];
    const workspace = payload.workspace || process.cwd();
    let additionalContext = payload.additionalContext || null;
    if (payload.webSearch !== false) {
      const textIndex = input.findIndex(item => item.type === 'text');
      if (textIndex >= 0) {
        sendToRenderer('app-server:event', { method: 'codex-flow/search', params: { status: 'running', text: '正在搜索实时网络信息' } });
        try {
          const results = await searchWeb(input[textIndex].text);
          input[textIndex] = { ...input[textIndex], text: buildSearchContext(input[textIndex].text, results) };
          additionalContext = {
            ...(additionalContext || {}),
            'codex-flow-web-search': { kind: 'application', value: WEB_SEARCH_DEVELOPER_INSTRUCTIONS }
          };
          sendToRenderer('app-server:event', { method: 'codex-flow/search', params: { status: 'completed', text: '已检索 ' + results.length + ' 个网络来源' } });
        } catch {
          sendToRenderer('app-server:event', { method: 'codex-flow/search', params: { status: 'completed', text: '客户端搜索不可用，继续使用 Codex 工具' } });
        }
      }
    }
    return appServer.request('turn/start', {
      threadId: payload.threadId,
      input,
      additionalContext,
      cwd: workspace,
      runtimeWorkspaceRoots: [workspace],
      approvalPolicy: payload.approvalPolicy || 'on-request',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      model: payload.model || null,
      multiAgentMode: payload.multiAgentMode || 'explicitRequestOnly',
      ...(payload.multiAgentMode === 'proactive' ? { effort: 'ultra' } : {})
    });
  });
  ipcMain.handle('app-server:turn-steer', async (_event, payload) => { await ensureAppServer(); return appServer.request('turn/steer', { threadId: payload.threadId, expectedTurnId: payload.turnId, input: payload.input }); });
  ipcMain.handle('app-server:turn-interrupt', async (_event, payload) => { await ensureAppServer(); return appServer.request('turn/interrupt', { threadId: payload.threadId, turnId: payload.turnId }); });
  ipcMain.handle('app-server:respond', async (_event, payload) => { await ensureAppServer(); appServer.respond(payload.requestId, payload.result, payload.error); return true; });
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
      const messages = (payload.messages || []).map(message => ({ ...message }));
      const promptIndex = messages.findLastIndex(message => message.role === 'user');
      const originalPrompt = promptIndex >= 0 ? messages[promptIndex].content : '对话';
      if (payload.webSearch !== false && promptIndex >= 0 && typeof messages[promptIndex].content === 'string') {
        event.sender.send('chat:event', { requestId, type: 'tool', status: 'running', itemType: 'web_search', text: '正在搜索实时网络信息' });
        try {
          const results = await searchWeb(messages[promptIndex].content);
          messages[promptIndex].content = buildSearchContext(messages[promptIndex].content, results);
          event.sender.send('chat:event', { requestId, type: 'tool', status: 'completed', itemType: 'web_search', text: '已检索 ' + results.length + ' 个网络来源' });
        } catch (searchError) {
          event.sender.send('chat:event', { requestId, type: 'tool', status: 'completed', itemType: 'web_search', text: '实时搜索失败：' + searchError.message });
        }
      }
      const result = await streamChat({
        provider,
        model: payload.model || provider.model,
        messages,
        signal: controller.signal,
        onEvent: data => event.sender.send('chat:event', { requestId, ...data })
      });
      const record = await recordUsage({ requestId, provider, model: payload.model || provider.model, usage: {
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        total_tokens: result.totalTokens
      }, estimated: result.estimated });
      await contentStore.addSession({ title: payload.title || String(originalPrompt).slice(0, 40), prompt: originalPrompt, response: result.output, model: payload.model || provider.model, source: payload.source || 'chat' });
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
  appServer = new AppServerService({
    onNotification: async notification => {
      sendToRenderer('app-server:event', notification);
      if (notification.method === 'thread/tokenUsage/updated') {
        const usage = notification.params.tokenUsage?.last;
        if (usage) appServerUsage.set(notification.params.turnId, usage);
      }
      if (notification.method === 'turn/completed') {
        const turnId = notification.params.turn?.id;
        const usage = appServerUsage.get(turnId);
        if (usage) {
          appServerUsage.delete(turnId);
          try {
            const provider = configStore.getProviderWithSecret();
            const record = await recordUsage({ requestId: turnId, provider, model: provider.model, usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens } });
            sendToRenderer('app-server:event', { method: 'codex-flow/usage', params: { threadId: notification.params.threadId, turnId, record } });
          } catch {}
        }
      }
    },
    onServerRequest: request => {
      if (mainWindow && !mainWindow.isDestroyed()) return sendToRenderer('app-server:request', request);
      if (request.method === 'item/tool/requestUserInput') appServer.respond(request.requestId, { answers: {} });
      else if (request.method === 'item/permissions/requestApproval') appServer.respond(request.requestId, { permissions: {}, scope: 'turn' });
      else appServer.respond(request.requestId, { decision: 'cancel' });
    },
    onStatus: status => sendToRenderer('app-server:status', status)
  });
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

app.on('before-quit', () => { clearInterval(schedulerTimer); appServer?.stop(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
