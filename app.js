const bridge = window.codex;
const byId = id => document.getElementById(id);
const meta = {
  chat: ['智能对话', 'Codex Agent、联网搜索与工具执行'],
  tasks: ['定时任务', '自动执行重复工作'],
  usage: ['用量统计', 'Token 与费用一目了然'],
  models: ['模型中心', '连接你的 AI 服务商'],
  plugins: ['Skills、插件与 MCP', '从 Codex 市场安装和管理扩展'],
  video: ['视频工作室', 'AI 驱动的自动剪辑'],
  cli: ['CLI 控制台', '图形界面与终端无缝协作']
};
const providerCatalog = [
  ['O', 'OpenAI', 'https://api.openai.com/v1', 'GPT 系列'],
  ['火', '火山方舟 Coding Plan', 'https://ark.cn-beijing.volces.com/api/coding/v3', 'Coding Plan'],
  ['阿', '阿里云百炼 Coding Plan', 'https://coding.dashscope.aliyuncs.com/v1', 'Coding Plan'],
  ['智', '智谱 GLM Coding Plan', 'https://open.bigmodel.cn/api/coding/paas/v4', 'GLM 系列'],
  ['腾', '腾讯云 Coding Plan', 'https://api.lkeap.cloud.tencent.com/coding/v3', 'Coding Plan'],
  ['D', 'DeepSeek', 'https://api.deepseek.com/v1', 'DeepSeek 系列'],
  ['Q', '通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'Qwen 系列'],
  ['+', '自定义服务商', '', 'OpenAI 兼容接口']
];
const pluginDescriptions = {
  browser: '让 Codex 操作内置浏览器，完成网页搜索、采集、表单和自动化测试。',
  chrome: '连接用户的 Chrome 浏览器，复用登录状态完成真实网页操作。',
  'computer-use': '控制 Windows 桌面应用和系统界面，完成跨应用工作流。',
  latex: '创建、编辑和检查 LaTeX 文档与数学排版。',
  github: '管理 GitHub 仓库、Issue、Pull Request 和开发工作流。',
  notion: '读取和更新 Notion 页面、数据库与团队知识库。',
  figma: '连接 Figma 设计资源，辅助设计分析和前端实现。',
  remotion: '使用 Remotion 生成和编辑程序化视频。',
  'codex-security': '执行代码安全审查、风险定位和修复建议。',
  'build-web-apps': '提供现代 Web 应用设计、开发和验证工作流。',
  'game-studio': '提供游戏原型、交互和资源制作工作流。',
  superpowers: '扩展复杂任务规划、调试、测试和工程执行能力。'
};

let publicConfig = { configured: false, provider: null };
let codingPlanPresets = {};
let activeRequestId = null;
let removeAgentListener = null;
let removeChatListener = null;
let currentWorkspace = null;
let webEnabled = true;
let answerMarkdown = '';
let extensions = { plugins: [], mcpServers: [] };
let extensionFilter = 'all';
let codexStatus = { available: false };
let selectedMedia = [];
let usageRecords = [];
let removeTaskListener = null;
let taskFilter = 'all';
let historySessions = [];
let savedPrompts = [];
let activeUsageRange = 'month';
let currentThreadId = null;
let currentTurnId = null;
let lastTurnId = null;
let currentThread = null;
let selectedImages = [];
let codexThreads = [];
let pendingInteraction = null;
let appServerTurnContext = null;
let removeAppServerEventListener = null;
let removeAppServerRequestListener = null;
let removeAppServerStatusListener = null;
const collabAgents = new Map();

function cleanError(error) {
  return String(error?.message || error || '操作失败').replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function page(id) {
  document.querySelectorAll('.page').forEach(element => element.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(element => element.classList.toggle('active', element.dataset.page === id));
  byId(id)?.classList.add('active');
  byId('title').textContent = meta[id][0];
  byId('subtitle').textContent = meta[id][1];
  if (id === 'plugins') loadExtensions();
  if (id === 'tasks') loadTasks();
  if (id === 'cli') loadCliStatus();
  if (id === 'usage') loadUsage('month');
  if (id === 'video') loadVideoProjects();
}

document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));

function modal(id, show = true) {
  byId(id)?.classList.toggle('show', show);
}

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal(button.dataset.close, false)));

function toastMsg(text) {
  byId('toastText').textContent = text;
  byId('toast').classList.add('show');
  clearTimeout(toastMsg.timer);
  toastMsg.timer = setTimeout(() => byId('toast').classList.remove('show'), 2400);
}

function markdownHtml(markdown) {
  if (window.marked && window.DOMPurify) {
    window.marked.setOptions({ gfm: true, breaks: true });
    return window.DOMPurify.sanitize(window.marked.parse(markdown || ''));
  }
  return '<p>' + escapeHtml(markdown || '').replace(/\n/g, '<br>') + '</p>';
}

function secureMarkdownLinks(root) {
  root?.querySelectorAll('a[href]').forEach(link => {
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
  });
}

function renderMarkdown(markdown) {
  answerMarkdown = markdown || '';
  const answer = byId('answer');
  if (!answer) return;
  answer.innerHTML = markdownHtml(answerMarkdown);
  secureMarkdownLinks(answer);
  answer.classList.remove('hide');
  byId('answerActions')?.classList.remove('hide');
}

function prepareConversation(prompt, agentMode = true) {
  byId('hero').classList.add('hide');
  byId('conversation').classList.remove('hide');
  let threadHistory = byId('threadHistory');
  if (!threadHistory) {
    threadHistory = document.createElement('div');
    threadHistory.id = 'threadHistory';
    threadHistory.className = 'thread-history';
    byId('conversation').prepend(threadHistory);
  }
  threadHistory.innerHTML = '';
  byId('userText').textContent = prompt;
  byId('agentState').textContent = agentMode ? 'Codex Flow · Agent 执行中' : 'Codex Flow · 普通对话';
  byId('thinking').textContent = agentMode ? '正在启动 Codex Agent...' : '正在等待模型响应...';
  byId('thinking').classList.remove('hide');
  byId('toolTrace').innerHTML = '';
  byId('answer').innerHTML = '';
  byId('answer').classList.add('hide');
  byId('answerActions')?.classList.add('hide');
  answerMarkdown = '';
  byId('inToken').textContent = '0';
  byId('outToken').textContent = '0';
}

function addToolEvent(event) {
  const trace = byId('toolTrace');
  const key = event.itemType + ':' + event.text;
  let row = [...trace.children].find(element => element.dataset.key === key);
  if (!row) {
    row = document.createElement('div');
    row.className = 'tool-event';
    row.dataset.key = key;
    row.innerHTML = '<i>⌘</i><span></span><em></em>';
    trace.appendChild(row);
  }
  row.querySelector('span').textContent = event.text;
  row.querySelector('em').textContent = event.status === 'completed' ? '完成' : '执行中';
  row.classList.toggle('completed', event.status === 'completed');
}

function finishRequest() {
  activeRequestId = null;
  currentTurnId = null;
  byId('send').textContent = '↑';
  byId('interruptTurn')?.classList.add('hide');
  document.querySelector('.composer').classList.remove('busy');
  byId('thinking').classList.add('hide');
  byId('agentState').textContent = 'Codex Flow · 已完成';
  loadUsage('month');
  loadHistory();
}

function appServerItemDescription(item) {
  if (item.type === 'commandExecution') return item.command ? '执行命令：' + item.command : '执行终端命令';
  if (item.type === 'fileChange') return '修改工作区文件';
  if (item.type === 'mcpToolCall') return '调用 MCP：' + item.server + ' / ' + item.tool;
  if (item.type === 'dynamicToolCall') return '调用工具：' + item.tool;
  if (item.type === 'webSearch') return '正在联网搜索';
  if (item.type === 'reasoning') return '正在分析任务';
  if (item.type === 'collabAgentToolCall') return '多代理协作：' + item.tool;
  if (item.type === 'subAgentActivity') return '子代理活动：' + item.kind;
  if (item.type === 'imageGeneration') return '正在生成图片';
  if (item.type === 'imageView') return '正在查看图片';
  return '正在执行：' + String(item.type || '任务');
}

function ensureAdvancedThreadActions() {
  if (byId('reviewCurrentThread')) return;
  byId('forkCurrentThread').insertAdjacentHTML('beforebegin', '<button id="reviewCurrentThread">代码审查</button><button id="compactCurrentThread">压缩上下文</button><button id="renameCurrentThread">重命名</button>');
  const sessionDescription = document.querySelector('#codexSessionsModal .dialog-head small');
  if (sessionDescription) sessionDescription.textContent = '恢复、分叉、命名、归档、压缩和删除 app-server 持久会话';
}

ensureAdvancedThreadActions();

function renderAgentGraph() {
  const agents = [...collabAgents.entries()];
  byId('agentGraph').innerHTML = agents.length ? agents.map(([id, agent]) => '<article><i class="' + (agent.status === 'completed' || agent.status === 'closed' ? 'done' : agent.status === 'failed' ? 'failed' : '') + '">' + (agent.status === 'completed' ? '✓' : '◉') + '</i><span><b>' + escapeHtml(agent.nickname || 'Agent ' + id.slice(0, 6)) + '</b><small>' + escapeHtml(agent.status || '运行中') + (agent.message ? ' · ' + escapeHtml(agent.message) : '') + '</small></span></article>').join('') : '<small>当前没有协作 Agent</small>';
}

function updateCollabItem(item) {
  if (item.type === 'collabAgentToolCall') {
    for (const id of item.receiverThreadIds || []) {
      const state = item.agentsStates?.[id] || {};
      collabAgents.set(id, { ...collabAgents.get(id), status: state.status || item.status, message: state.message || item.prompt || '' });
    }
  }
  if (item.type === 'subAgentActivity') collabAgents.set(item.agentThreadId, { ...collabAgents.get(item.agentThreadId), status: item.kind, message: item.agentPath });
  renderAgentGraph();
}

async function handleAppServerEvent(event) {
  const { method, params } = event;
  if (method === 'codex-flow/search') {
    addToolEvent({ itemType: 'webSearch', text: params.text, status: params.status });
    byId('thinking').textContent = params.text;
    return;
  }
  if (method === 'serverRequest/resolved' && pendingInteraction && String(params.requestId) === String(pendingInteraction.requestId)) {
    pendingInteraction = null;
    modal('approvalModal', false);
    modal('userInputModal', false);
    return;
  }
  if (method === 'turn/started' && params.threadId === currentThreadId) {
    currentTurnId = params.turn.id;
    lastTurnId = params.turn.id;
    document.querySelector('.composer').classList.add('busy');
    byId('interruptTurn').classList.remove('hide');
    byId('agentState').textContent = 'Codex Flow · app-server 执行中';
    return;
  }
  if (method === 'item/agentMessage/delta' && params.threadId === currentThreadId) {
    answerMarkdown += params.delta;
    renderMarkdown(answerMarkdown);
    return;
  }
  if ((method === 'item/started' || method === 'item/completed') && params.threadId === currentThreadId) {
    const item = params.item || {};
    if (item.type === 'agentMessage' && item.text) renderMarkdown(item.text);
    else if (item.type !== 'userMessage') addToolEvent({ itemType: item.type, text: appServerItemDescription(item), status: method === 'item/completed' ? 'completed' : 'running' });
    updateCollabItem(item);
    return;
  }
  if (method === 'codex-flow/usage' && params.threadId === currentThreadId) {
    byId('inToken').textContent = Number(params.record.inputTokens || 0).toLocaleString('zh-CN');
    byId('outToken').textContent = Number(params.record.outputTokens || 0).toLocaleString('zh-CN');
    return;
  }
  if (method === 'turn/completed' && params.threadId === currentThreadId) {
    lastTurnId = params.turn.id;
    const turnContext = appServerTurnContext;
    appServerTurnContext = null;
    if (params.turn.status === 'failed') {
      byId('thinking').textContent = params.turn.error?.message || '本轮执行失败。';
      byId('thinking').classList.add('stream-error');
      finishRequest();
      if (turnContext?.hasImages) {
        toastMsg('当前接口不兼容 app-server，图片附件暂时无法回退执行');
        return;
      }
      if (turnContext) {
        currentThreadId = null;
        currentThread = null;
        toastMsg('app-server 执行失败，已回退到 Codex exec');
        await runAgentFallback(turnContext.prompt, turnContext.context);
      }
      return;
    }
    finishRequest();
    loadCodexSessions();
    return;
  }
  if (method === 'error') {
    byId('thinking').textContent = params.error?.message || params.message || 'app-server 出现错误。';
    byId('thinking').classList.add('stream-error');
  }
}

function interactionDetail(request) {
  const params = request.params || {};
  if (request.method === 'item/commandExecution/requestApproval') return (params.reason ? params.reason + '\n\n' : '') + (params.command || '终端命令') + (params.cwd ? '\n\n工作目录：' + params.cwd : '');
  if (request.method === 'item/fileChange/requestApproval') return (params.reason || 'Codex 请求修改工作区文件。') + (params.grantRoot ? '\n\n目录：' + params.grantRoot : '');
  if (request.method === 'item/permissions/requestApproval') return (params.reason || 'Codex 请求额外权限。') + '\n\n' + JSON.stringify(params.permissions || {}, null, 2);
  return JSON.stringify(params, null, 2);
}

function handleAppServerRequest(request) {
  pendingInteraction = request;
  if (request.method === 'item/tool/requestUserInput') {
    const questions = request.params.questions || [];
    byId('userInputQuestions').innerHTML = questions.map(question => {
      const options = question.options?.length ? '<select>' + question.options.map(option => '<option value="' + escapeHtml(option.label) + '">' + escapeHtml(option.label) + ' — ' + escapeHtml(option.description) + '</option>').join('') + '</select>' : '';
      const custom = (!question.options?.length || question.isOther) ? '<input data-custom-answer ' + (question.isSecret ? 'type="password"' : '') + ' placeholder="' + (question.options?.length ? '或输入自定义回答' : '请输入回答') + '">' : '';
      return '<fieldset data-question="' + escapeHtml(question.id) + '"><legend>' + escapeHtml(question.header || '补充信息') + '</legend><p>' + escapeHtml(question.question) + '</p>' + options + custom + '</fieldset>';
    }).join('');
    modal('userInputModal');
    return;
  }
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(request.method)) {
    byId('approvalTitle').textContent = request.method.includes('commandExecution') ? '允许执行命令？' : request.method.includes('fileChange') ? '允许修改文件？' : '允许额外权限？';
    byId('approvalDetail').textContent = interactionDetail(request);
    byId('approvalSessionScope').checked = false;
    modal('approvalModal');
    return;
  }
  bridge.appServer.respond({ requestId: request.requestId, error: { code: -32601, message: 'Codex Flow 暂不支持此交互请求。' } });
  pendingInteraction = null;
}

function buildTurnInput(text) {
  const input = [];
  if (text) input.push({ type: 'text', text, text_elements: [] });
  selectedImages.forEach(path => input.push({ type: 'localImage', path }));
  return input;
}

async function respondToInteraction(result) {
  if (!pendingInteraction) return;
  const request = pendingInteraction;
  pendingInteraction = null;
  modal('approvalModal', false);
  modal('userInputModal', false);
  await bridge.appServer.respond({ requestId: request.requestId, result });
}

byId('acceptApproval').addEventListener('click', async () => {
  if (!pendingInteraction) return;
  const session = byId('approvalSessionScope').checked;
  if (pendingInteraction.method === 'item/permissions/requestApproval') {
    const requested = pendingInteraction.params.permissions || {};
    await respondToInteraction({ permissions: { ...(requested.network ? { network: requested.network } : {}), ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {}) }, scope: session ? 'session' : 'turn' });
  } else await respondToInteraction({ decision: session ? 'acceptForSession' : 'accept' });
});
byId('declineApproval').addEventListener('click', async () => {
  if (!pendingInteraction) return;
  if (pendingInteraction.method === 'item/permissions/requestApproval') await respondToInteraction({ permissions: {}, scope: 'turn' });
  else await respondToInteraction({ decision: 'decline' });
});
byId('submitUserInput').addEventListener('click', async () => {
  const answers = {};
  byId('userInputQuestions').querySelectorAll('[data-question]').forEach(fieldset => {
    const customAnswer = fieldset.querySelector('[data-custom-answer]')?.value.trim();
    const selectedAnswer = fieldset.querySelector('select')?.value;
    const answer = customAnswer || selectedAnswer;
    answers[fieldset.dataset.question] = { answers: answer ? [answer] : [] };
  });
  await respondToInteraction({ answers });
});
byId('cancelUserInput').addEventListener('click', () => respondToInteraction({ answers: {} }));

async function startAppServerTurn(prompt, context = {}) {
  if (!currentThreadId) {
    const response = await bridge.appServer.startThread({ model: byId('modelPicker').value, workspace: currentWorkspace, approvalPolicy: 'on-request' });
    currentThread = response.thread;
    currentThreadId = response.thread.id;
  }
  prepareConversation(prompt, true);
  collabAgents.clear();
  renderAgentGraph();
  document.querySelector('.composer').classList.add('busy');
  byId('interruptTurn').classList.remove('hide');
  appServerTurnContext = { prompt, context, hasImages: selectedImages.length > 0 };
  const response = await bridge.appServer.startTurn({ threadId: currentThreadId, input: buildTurnInput(prompt), model: byId('modelPicker').value, workspace: currentWorkspace, webSearch: webEnabled, multiAgentMode: byId('multiAgentMode').value, source: context.source || 'chat' });
  currentTurnId = response.turn.id;
  selectedImages = [];
  renderAttachmentPreview();
}

async function runAgentFallback(prompt, context = {}) {
  activeRequestId = crypto.randomUUID();
  const requestId = activeRequestId;
  prepareConversation(prompt, true);
  document.querySelector('.composer').classList.add('busy');
  try {
    await bridge.agent.start({
      requestId,
      prompt,
      model: byId('modelPicker').value,
      workspace: currentWorkspace,
      webSearch: webEnabled,
      source: context.source || 'chat',
      title: context.title || prompt.slice(0, 40)
    });
  } catch (error) {
    if (activeRequestId !== requestId) return;
    activeRequestId = null;
    toastMsg('Codex Agent 不兼容当前接口，已回退到普通流式对话');
    try {
      await runDirectChat(prompt, context);
    } catch (fallbackError) {
      byId('thinking').textContent = cleanError(fallbackError);
      byId('thinking').classList.add('stream-error');
      finishRequest();
    }
  }
}

function handleAgentEvent(event) {
  if (event.requestId !== activeRequestId) return;
  if (event.type === 'status') {
    byId('thinking').textContent = event.text;
    return;
  }
  if (event.type === 'tool') {
    addToolEvent(event);
    byId('thinking').textContent = event.text;
    return;
  }
  if (event.type === 'message') {
    renderMarkdown(event.markdown);
    return;
  }
  if (event.type === 'usage') {
    byId('inToken').textContent = Number(event.record.inputTokens || 0).toLocaleString('zh-CN');
    byId('outToken').textContent = Number(event.record.outputTokens || 0).toLocaleString('zh-CN');
    return;
  }
  if (event.type === 'done') finishRequest();
  if (event.type === 'error') {
    byId('thinking').textContent = event.message;
    byId('thinking').classList.add('stream-error');
  }
}

function handleChatEvent(event) {
  if (event.requestId !== activeRequestId) return;
  if (event.type === 'tool') {
    addToolEvent(event);
    byId('thinking').textContent = event.text;
    return;
  }
  if (event.type === 'delta') {
    answerMarkdown += event.text;
    renderMarkdown(answerMarkdown);
    return;
  }
  if (event.type === 'usage') {
    byId('inToken').textContent = Number(event.record.inputTokens || 0).toLocaleString('zh-CN');
    byId('outToken').textContent = Number(event.record.outputTokens || 0).toLocaleString('zh-CN');
    return;
  }
  if (event.type === 'done') finishRequest();
  if (event.type === 'error') {
    byId('thinking').textContent = event.message;
    byId('thinking').classList.add('stream-error');
  }
}

async function runDirectChat(prompt, context = {}) {
  activeRequestId = crypto.randomUUID();
  prepareConversation(prompt, false);
  document.querySelector('.composer').classList.add('busy');
  await bridge.chat.start({
    requestId: activeRequestId,
    model: byId('modelPicker').value,
    messages: [{ role: 'user', content: prompt }],
    webSearch: webEnabled,
    source: context.source || 'chat',
    title: context.title || prompt.slice(0, 40)
  });
}

async function sendPrompt(options = {}) {
  const context = options?.source ? options : {};
  const value = byId('prompt').value.trim();
  if (!value && !selectedImages.length) return;
  if (currentTurnId) {
    try {
      await bridge.appServer.steerTurn({ threadId: currentThreadId, turnId: currentTurnId, input: buildTurnInput(value) });
      byId('prompt').value = '';
      selectedImages = [];
      renderAttachmentPreview();
      toastMsg('补充要求已发送给当前 Agent');
    } catch (error) { toastMsg(cleanError(error)); }
    return;
  }
  if (activeRequestId && bridge) {
    await Promise.allSettled([bridge.agent.cancel(activeRequestId), bridge.chat.cancel(activeRequestId)]);
    return;
  }
  byId('prompt').value = '';
  if (!bridge || !publicConfig.configured) {
    byId('prompt').value = value;
    modal('welcome');
    toastMsg('请先连接 API Key，再执行真实任务');
    return;
  }
  try {
    if (!codexStatus.available) throw new Error(codexStatus.error || 'Codex 引擎不可用。');
    await startAppServerTurn(value, context);
    return;
  } catch (appServerError) {
    appServerTurnContext = null;
    currentThreadId = null;
    currentThread = null;
    currentTurnId = null;
    byId('interruptTurn').classList.add('hide');
    if (selectedImages.length) {
      byId('prompt').value = value;
      toastMsg('当前接口不兼容 app-server，图片附件无法使用：' + cleanError(appServerError));
      finishRequest();
      return;
    }
    toastMsg('app-server 不兼容当前接口，已回退到 Codex exec');
  }
  await runAgentFallback(value, context);
}

byId('send').addEventListener('click', sendPrompt);
byId('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPrompt();
  }
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  byId('prompt').value = button.dataset.prompt;
  sendPrompt();
}));

function renderAttachmentPreview() {
  const preview = byId('attachmentPreview');
  preview.classList.toggle('hide', selectedImages.length === 0);
  preview.innerHTML = selectedImages.map((path, index) => '<span title="' + escapeHtml(path) + '">▧ ' + escapeHtml(path.split(/[\\/]/).pop()) + '<button data-remove-image="' + index + '">×</button></span>').join('');
}

byId('attachImages').addEventListener('click', async () => {
  const images = await bridge.images.choose();
  selectedImages = [...new Set([...selectedImages, ...images])].slice(0, 10);
  renderAttachmentPreview();
});
byId('attachmentPreview').addEventListener('click', event => {
  const index = Number(event.target.closest('[data-remove-image]')?.dataset.removeImage);
  if (Number.isInteger(index)) { selectedImages.splice(index, 1); renderAttachmentPreview(); }
});
byId('interruptTurn').addEventListener('click', async () => {
  if (!currentThreadId || !currentTurnId) return;
  await bridge.appServer.interruptTurn({ threadId: currentThreadId, turnId: currentTurnId });
  toastMsg('正在停止当前执行');
});

byId('webToggle').addEventListener('click', () => {
  webEnabled = !webEnabled;
  byId('webToggle').classList.toggle('active', webEnabled);
  byId('contextWebToggle')?.classList.toggle('on', webEnabled);
  toastMsg(webEnabled ? '已启用实时联网搜索' : '已关闭联网搜索');
});
byId('contextWebToggle')?.addEventListener('click', () => byId('webToggle').click());
byId('openTools').addEventListener('click', () => page('plugins'));
document.querySelectorAll('.context .cap .toggle')[1]?.addEventListener('click', () => page('plugins'));
document.querySelectorAll('.context .cap .toggle')[2]?.addEventListener('click', () => byId('chooseWorkspace').click());
document.querySelector('.context-title button')?.addEventListener('click', () => document.querySelector('.context').classList.toggle('hide'));
document.querySelector('.safe-banner button')?.addEventListener('click', () => toastMsg('API Key 使用 Electron safeStorage 加密，仅请求对应厂商时解密使用'));
byId('chooseWorkspace').addEventListener('click', async () => {
  const selected = await bridge?.workspace.choose();
  if (!selected) return;
  currentWorkspace = selected;
  byId('workspaceLabel').textContent = '工作区：' + selected;
  toastMsg('Codex 工作区已更新');
});

byId('copyAnswer').addEventListener('click', async () => {
  await navigator.clipboard.writeText(answerMarkdown);
  toastMsg('回答已复制');
});
byId('exportAnswer').addEventListener('click', () => {
  const blob = new Blob([answerMarkdown], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'codex-flow-answer.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
byId('answerSchedule')?.addEventListener('click', () => {
  byId('taskPrompt').value = byId('userText').textContent || '';
  byId('taskName').value = (byId('userText').textContent || '新任务').slice(0, 20);
  byId('newTask').click();
});

function taskScheduleLabel(task) {
  if (task.schedule.type === 'hourly') return '每小时 ' + (task.schedule.timesPerHour || 1) + ' 次';
  if (task.schedule.type === 'weekly') {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return '每周' + weekdays[Number(task.schedule.dayOfWeek || 0)] + ' · ' + task.schedule.time;
  }
  return '每天 · ' + task.schedule.time;
}

async function loadTasks() {
  if (!bridge) return;
  const [tasks, summary] = await Promise.all([bridge.tasks.list(), bridge.tasks.summary()]);
  byId('taskRunning').textContent = summary.running;
  byId('taskMonthly').textContent = summary.monthlyRuns;
  byId('taskSuccess').textContent = summary.monthlyRuns ? '成功率 ' + Math.round(summary.successes / summary.monthlyRuns * 100) + '%' : '等待执行';
  byId('taskNextTime').textContent = summary.next ? new Date(summary.next.nextRunAt).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';
  byId('taskNextName').textContent = summary.next?.name || '暂无任务';
  byId('taskBadge').textContent = summary.running;
  byId('taskBadge').classList.toggle('hide', summary.running === 0);
  const filtered = tasks.filter(task => taskFilter === 'all' || (taskFilter === 'enabled' ? task.enabled : !task.enabled));
  byId('taskList').innerHTML = filtered.length ? filtered.map(task => '<div class="task-row" data-id="' + task.id + '"><i>◷</i><span><b>' + escapeHtml(task.name) + '</b><p>' + escapeHtml(taskScheduleLabel(task)) + ' · ' + escapeHtml(task.model || '-') + '</p></span><small>下次：' + new Date(task.nextRunAt).toLocaleString('zh-CN') + '<br>' + escapeHtml(task.lastStatus || 'pending') + '</small><button class="toggle task-toggle ' + (task.enabled ? 'on' : '') + '" title="暂停或启用"><i></i></button><button class="task-run">运行</button><button class="task-delete">删除</button></div>').join('') : '<div class="empty-extensions">当前筛选下没有定时任务。</div>';
}

function renderProviders() {
  const selectedName = publicConfig.provider?.name;
  byId('providers').innerHTML = providerCatalog.map(provider => {
    const connected = publicConfig.configured && selectedName === provider[1];
    const discovered = connected ? publicConfig.provider.models.map(model => model.id) : [];
    const labels = discovered.length ? discovered.slice(0, 4) : provider[3].split(',');
    const more = discovered.length > 4 ? '<span>+' + (discovered.length - 4) + '</span>' : '';
    return '<article class="provider"><div class="provider-head"><i>' + provider[0] + '</i><span><b>' + provider[1] + '</b><small>' + (connected ? '已连接 · ' + publicConfig.provider.baseUrl : provider[2] || '填写自定义地址') + '</small></span><em class="' + (connected ? 'online' : '') + '">' + (connected ? '● 已连接' : '未连接') + '</em></div><div class="provider-models">' + labels.map(label => '<span>' + escapeHtml(label) + '</span>').join('') + more + '</div><div class="provider-foot"><span>' + (connected ? discovered.length + ' 个模型可用' : 'OpenAI 兼容') + '</span><button class="open-provider" data-name="' + provider[1] + '" data-url="' + provider[2] + '">' + (connected ? '管理' : '连接') + '</button></div></article>';
  }).join('');
}

async function loadUsage(range) {
  if (!bridge) return;
  activeUsageRange = range;
  const [summary, records] = await Promise.all([bridge.usage.summary(range), bridge.usage.list(100)]);
  const now = new Date();
  usageRecords = records.filter(record => {
    const date = new Date(record.createdAt);
    if (range === 'day') return date.toDateString() === now.toDateString();
    if (range === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    if (range === 'year') return date.getFullYear() === now.getFullYear();
    return true;
  });
  byId('requests').textContent = Number(summary.requests).toLocaleString('zh-CN');
  byId('totalToken').textContent = Number(summary.totalTokens).toLocaleString('zh-CN');
  byId('totalCost').textContent = '¥' + Number(summary.estimatedCost || 0).toFixed(2);
  const visibleRecords = usageRecords.slice(0, 14).reverse();
  const max = Math.max(1, ...visibleRecords.map(record => Number(record.totalTokens || 0)));
  byId('bars').innerHTML = visibleRecords.length ? visibleRecords.map(record => '<i style="height:' + Math.max(8, Math.round(Number(record.totalTokens || 0) / max * 100)) + '%" title="' + Number(record.totalTokens || 0).toLocaleString('zh-CN') + ' tokens"></i>').join('') : '<i style="height:8%"></i>';
  byId('usageAxis').textContent = visibleRecords.length ? visibleRecords.map(record => new Date(record.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })).join('　') : '暂无记录';
  const rangeLabels = { day: '今日', month: now.getFullYear() + '年' + (now.getMonth() + 1) + '月', year: now.getFullYear() + '年', all: '全部历史' };
  byId('usageRangeLabel').textContent = rangeLabels[range];
  byId('donutTotal').textContent = Number(summary.totalTokens).toLocaleString('zh-CN');
  byId('recentModel').textContent = usageRecords[0]?.modelId || '--';
  const totals = new Map(); usageRecords.forEach(record => totals.set(record.modelId || '未知模型', (totals.get(record.modelId || '未知模型') || 0) + Number(record.totalTokens || 0)));
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
  const modelTotals = [...totals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  byId('modelShares').innerHTML = modelTotals.map(([model,value]) => '<p><i></i>' + escapeHtml(model) + ' <b>' + Math.round(value / total * 100) + '%</b></p>').join('') || '<p>暂无记录</p>';
  const colors = ['#8fbd4f', '#7482ef', '#f0a657', '#a0a6b5', '#d4d7df'];
  let offset = 0;
  const segments = modelTotals.map(([, value], index) => { const start = offset; offset += value / total * 100; return colors[index] + ' ' + start.toFixed(2) + '% ' + offset.toFixed(2) + '%'; });
  document.querySelector('.donut').style.background = segments.length ? 'conic-gradient(' + segments.join(',') + ')' : '#e2e5eb';
  byId('usageRows').innerHTML = usageRecords.length ? usageRecords.slice(0, 20).map(record => '<tr><td>' + new Date(record.createdAt).toLocaleString('zh-CN') + '</td><td>' + escapeHtml(record.modelId || '-') + '</td><td>' + Number(record.inputTokens || 0).toLocaleString('zh-CN') + '</td><td>' + Number(record.outputTokens || 0).toLocaleString('zh-CN') + '</td><td>' + Number(record.totalTokens || 0).toLocaleString('zh-CN') + '</td><td><b>成功</b></td></tr>').join('') : '<tr><td colspan="6">当前范围暂无请求记录</td></tr>';
}

document.querySelectorAll('.ranges button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.ranges button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  loadUsage(button.dataset.range || 'month');
}));

function extensionIcon(name) {
  if (/browser|chrome/.test(name)) return '◎';
  if (/github|code|web/.test(name)) return '▣';
  if (/image|figma|latex/.test(name)) return '✦';
  if (/video|remotion|game/.test(name)) return '▷';
  return '⌘';
}

function pluginIconMarkup(plugin) {
  if (!plugin.iconDataUrl) return '<i class="plugin-icon">' + extensionIcon(plugin.name) + '</i>';
  const color = /^#[0-9a-f]{3,8}$/i.test(plugin.brandColor || '') ? plugin.brandColor : '#f1f2f5';
  return '<i class="plugin-icon has-image" style="--plugin-brand:' + color + '"><img src="' + escapeHtml(plugin.iconDataUrl) + '" alt=""></i>';
}

function renderExtensions() {
  const query = byId('pluginSearch').value.trim().toLowerCase();
  const pluginCards = extensions.plugins.filter(plugin => {
    if (extensionFilter === 'installed' && !plugin.installed) return false;
    if (extensionFilter === 'mcp') return false;
    return !query || (plugin.name + ' ' + (plugin.displayName || '') + ' ' + plugin.marketplace + ' ' + (plugin.description || '')).toLowerCase().includes(query);
  }).map(plugin => {
    const description = pluginDescriptions[plugin.name] || plugin.description || '来自 ' + plugin.marketplace + ' 的 Codex 扩展，可为 Agent 增加专业工作流、工具或 Skills。';
    const displayName = plugin.displayName || plugin.name;
    const button = plugin.installed
      ? '<button class="installed extension-action" data-action="remove" data-id="' + plugin.id + '">✓ 已安装</button>'
      : '<button class="install extension-action" data-action="install" data-id="' + plugin.id + '">安装</button>';
    return '<article class="plugin"><div class="plugin-head">' + pluginIconMarkup(plugin) + button + '</div><h3>' + escapeHtml(displayName) + '</h3><p>' + escapeHtml(description) + '</p><small>' + escapeHtml(plugin.marketplace) + (plugin.version ? ' · v' + escapeHtml(plugin.version) : '') + '</small></article>';
  });
  const mcpCards = extensions.mcpServers.filter(server => {
    if (extensionFilter === 'plugin') return false;
    if (extensionFilter === 'installed' && !server.enabled) return false;
    return !query || server.name.toLowerCase().includes(query);
  }).map(server => '<article class="plugin"><div class="plugin-head"><i class="plugin-icon">◆</i><button class="installed extension-action" data-action="remove-mcp" data-id="' + escapeHtml(server.name) + '">' + (server.enabled ? '✓ 已启用' : '已停用') + '</button></div><h3>' + escapeHtml(server.name) + '</h3><p>自定义 MCP 服务，通过 ' + escapeHtml(server.transport) + ' 向 Codex 提供实时工具和外部数据。</p><small>MCP · 授权状态 ' + escapeHtml(server.authStatus) + '</small></article>');
  const cards = extensionFilter === 'mcp' ? mcpCards : extensionFilter === 'plugin' ? pluginCards : [...pluginCards, ...mcpCards];
  byId('pluginGrid').innerHTML = cards.length ? cards.join('') : '<div class="empty-extensions">没有找到匹配的扩展。</div>';
}

async function loadExtensions(force = false) {
  if (!bridge || (!force && extensions.plugins.length)) {
    renderExtensions();
    return;
  }
  byId('extensionStatus').textContent = '正在读取 Codex 插件市场与 MCP 配置...';
  try {
    extensions = await bridge.extensions.list();
    byId('extensionStatus').textContent = '已发现 ' + extensions.plugins.length + ' 个插件，' + extensions.mcpServers.length + ' 个 MCP 服务。';
    renderExtensions();
  } catch (error) {
    byId('extensionStatus').textContent = cleanError(error);
    byId('pluginGrid').innerHTML = '<div class="empty-extensions">Codex 扩展市场暂时不可用。</div>';
  }
}

const pluginSearchLabel = byId('pluginSearch').closest('label');
pluginSearchLabel.classList.add('plugin-search-bar');
byId('extensionFilters').before(pluginSearchLabel);
byId('pluginSearch').addEventListener('input', renderExtensions);
byId('extensionFilters').addEventListener('click', event => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  extensionFilter = button.dataset.filter;
  byId('extensionFilters').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  renderExtensions();
});
byId('pluginGrid').addEventListener('click', async event => {
  const button = event.target.closest('.extension-action');
  if (!button || button.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = button.dataset.action === 'install' ? '安装中...' : '处理中...';
  try {
    if (button.dataset.action === 'install') await bridge.extensions.install(button.dataset.id);
    if (button.dataset.action === 'remove') await bridge.extensions.remove(button.dataset.id);
    if (button.dataset.action === 'remove-mcp') await bridge.extensions.removeMcp(button.dataset.id);
    extensions = { plugins: [], mcpServers: [] };
    await loadExtensions(true);
    toastMsg('扩展配置已更新，新对话将自动加载');
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    toastMsg(cleanError(error));
  }
});

byId('customPlugin').addEventListener('click', () => modal('mcpModal'));
byId('mcpType').addEventListener('change', () => {
  const isUrl = byId('mcpType').value === 'url';
  byId('mcpUrlFields').classList.toggle('hide', !isUrl);
  byId('mcpCommandFields').classList.toggle('hide', isUrl);
});
byId('saveMcp').addEventListener('click', async () => {
  const button = byId('saveMcp');
  button.disabled = true;
  try {
    await bridge.extensions.addMcp({
      name: byId('mcpName').value.trim(),
      type: byId('mcpType').value,
      url: byId('mcpUrl').value.trim(),
      command: byId('mcpCommand').value.trim(),
      args: byId('mcpArgs').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    });
    modal('mcpModal', false);
    extensions = { plugins: [], mcpServers: [] };
    await loadExtensions(true);
    toastMsg('MCP 服务已添加');
  } catch (error) {
    toastMsg(cleanError(error));
  } finally {
    button.disabled = false;
  }
});

function updateTaskScheduleFields() {
  const frequency = byId('taskFrequency').value;
  byId('taskTimeField').classList.toggle('hide', frequency === 'hourly');
  byId('taskHourlyField').classList.toggle('hide', frequency !== 'hourly');
  byId('taskWeekdayField').classList.toggle('hide', frequency !== 'weekly');
}

byId('newTask').addEventListener('click', () => {
  if (!publicConfig.configured) return modal('welcome');
  byId('taskModel').innerHTML = byId('modelPicker').innerHTML;
  byId('taskModel').value = byId('modelPicker').value;
  updateTaskScheduleFields();
  modal('taskModal');
});
byId('taskFrequency').addEventListener('change', updateTaskScheduleFields);
document.querySelector('.close-task').addEventListener('click', () => modal('taskModal', false));
byId('saveTask').addEventListener('click', async () => {
  const frequency = byId('taskFrequency').value;
  const name = byId('taskName').value.trim();
  const prompt = byId('taskPrompt').value.trim();
  if (!name || !prompt) return toastMsg('请填写任务名称和执行提示词');
  const timesPerHour = Math.max(1, Math.min(60, Number(byId('taskTimesPerHour').value) || 1));
  await bridge.tasks.save({ name, prompt, schedule: { type: frequency, time: byId('taskTime').value || '08:00:00', timesPerHour, dayOfWeek: Number(byId('taskWeekday').value) }, model: byId('taskModel').value, workspace: currentWorkspace, webSearch: webEnabled, enabled: true });
  modal('taskModal', false); await loadTasks(); toastMsg('定时任务已创建并开始本地调度');
});
byId('taskList').addEventListener('click', async event => { const row = event.target.closest('[data-id]'); if (!row) return; const id = row.dataset.id; if (event.target.closest('.task-toggle')) await bridge.tasks.toggle(id, !event.target.closest('.task-toggle').classList.contains('on')); if (event.target.closest('.task-run')) { await bridge.tasks.run(id); toastMsg('任务已开始执行'); } if (event.target.closest('.task-delete')) await bridge.tasks.remove(id); await loadTasks(); });
byId('taskFilters').addEventListener('click', event => {
  const button = event.target.closest('[data-task-filter]');
  if (!button) return;
  taskFilter = button.dataset.taskFilter;
  byId('taskFilters').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  loadTasks();
});
byId('refreshTasks').addEventListener('click', loadTasks);
byId('showKey').addEventListener('click', () => {
  byId('apiKey').type = byId('apiKey').type === 'password' ? 'text' : 'password';
});
async function connectOnboarding() {
  const button = byId('connect');
  const selected = document.querySelector('.choices button.active');
  const type = selected?.dataset.provider || 'openai';
  const presets = {
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }
  };
  const custom = type === 'custom';
  const name = custom ? byId('customProviderName').value.trim() : presets[type].name;
  const baseUrl = custom ? byId('customBaseUrl').value.trim() : presets[type].baseUrl;
  const model = custom ? byId('customModelId').value.trim() : '';
  if (custom && (!name || !baseUrl)) return toastMsg('请填写服务商名称和 API Base URL');
  if (!bridge) return modal('welcome', false);
  button.disabled = true;
  button.querySelector('span').textContent = '正在验证并发现模型...';
  try {
    publicConfig = await bridge.provider.saveAndDiscover({ id: name.toLowerCase().replaceAll(' ', '-'), name, baseUrl, apiKey: byId('apiKey').value, model });
    applyConfig();
    modal('welcome', false);
    toastMsg('连接成功，已载入 ' + publicConfig.provider.models.length + ' 个模型');
  } catch (error) {
    toastMsg(cleanError(error));
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = '连接并开始使用';
  }
}
byId('connect').addEventListener('click', connectOnboarding);

document.addEventListener('click', event => {
  const providerButton = event.target.closest('.open-provider');
  if (providerButton) {
    byId('providerName').value = providerButton.dataset.name === '自定义服务商' ? 'OpenAI 兼容接口' : providerButton.dataset.name;
    byId('providerBaseUrl').value = providerButton.dataset.url || '';
    byId('providerModelId').value = codingPlanPresets[providerButton.dataset.name]?.model || '';
    modal('providerModal');
  }
  if (event.target.closest('.quick')) handleQuickAction(event.target.closest('.quick'));
  const template = event.target.closest('.video-template'); if (template) { byId('videoPrompt').value = template.closest('article').querySelector('b').textContent + '：' + byId('videoPrompt').value; toastMsg('模板已应用'); }
});

document.querySelectorAll('.choices button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  byId('onboardingCustom').classList.toggle('hide', button.dataset.provider !== 'custom');
}));

byId('providerName').addEventListener('change', () => {
  const map = {
    OpenAI: 'https://api.openai.com/v1',
    DeepSeek: 'https://api.deepseek.com/v1',
    通义千问: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  };
  const name = byId('providerName').value;
  const plan = codingPlanPresets[name];
  if (plan) {
    byId('providerBaseUrl').value = plan.baseUrl;
    byId('providerModelId').value = plan.model;
  } else if (map[name]) {
    byId('providerBaseUrl').value = map[name];
    byId('providerModelId').value = '';
  }
});

byId('providerConnect').addEventListener('click', async () => {
  const button = byId('providerConnect');
  button.disabled = true;
  button.textContent = '正在发现模型...';
  try {
    publicConfig = await bridge.provider.saveAndDiscover({
      id: byId('providerName').value.toLowerCase().replaceAll(' ', '-'),
      name: byId('providerName').value,
      baseUrl: byId('providerBaseUrl').value,
      apiKey: byId('providerApiKey').value,
      model: byId('providerModelId').value
    });
    applyConfig();
    modal('providerModal', false);
    toastMsg('连接成功，发现 ' + publicConfig.provider.models.length + ' 个模型');
  } catch (error) {
    toastMsg(cleanError(error));
  } finally {
    button.disabled = false;
    button.textContent = '测试并连接';
  }
});

function applyConfig() {
  renderProviders();
  const picker = byId('modelPicker');
  const models = publicConfig.provider?.models || [];
  picker.innerHTML = models.length ? models.map(model => '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.id) + '</option>').join('') : '<option>GPT-5.4</option>';
  if (publicConfig.provider?.model) picker.value = publicConfig.provider.model;
  const connection = document.querySelector('.connection');
  const engine = codexStatus.available ? 'Codex Agent ' + codexStatus.version.replace('codex-cli ', '') : '普通对话模式';
  connection.innerHTML = '<i></i>' + (publicConfig.configured ? engine : '未连接 API');
}

byId('modelPicker').addEventListener('change', async () => {
  if (bridge && publicConfig.configured) {
    publicConfig = await bridge.provider.setModel(byId('modelPicker').value);
    toastMsg('默认模型已切换');
  }
});

function cleanThreadPrompt(value) {
  return String(value || '').replace(/^用户问题：\s*/i, '').replace(/<web_search_results>[\s\S]*?<\/web_search_results>/gi, '').trim();
}

function threadInputText(content = []) {
  return cleanThreadPrompt(content.map(item => item.type === 'text' ? item.text : item.type === 'localImage' ? '[图片] ' + item.path.split(/[\\/]/).pop() : item.type === 'image' ? '[网络图片]' : '').filter(Boolean).join('\n'));
}

function renderCodexThread(thread) {
  currentThread = thread;
  currentThreadId = thread.id;
  const turns = thread.turns || [];
  const latest = [...turns].reverse().find(turn => turn.items?.length) || null;
  lastTurnId = latest?.id || null;
  const userItem = latest?.items?.filter(item => item.type === 'userMessage').at(-1);
  const agentItems = latest?.items?.filter(item => item.type === 'agentMessage') || [];
  const prompt = userItem ? threadInputText(userItem.content) : thread.preview || thread.name || '恢复的 Codex 会话';
  prepareConversation(prompt, false);
  const previousTurns = turns.filter(turn => turn !== latest && turn.items?.length);
  byId('threadHistory').innerHTML = previousTurns.map(turn => {
    const userText = turn.items.filter(item => item.type === 'userMessage').map(item => threadInputText(item.content)).filter(Boolean).join('\n\n');
    const agentText = turn.items.filter(item => item.type === 'agentMessage').map(item => item.text).filter(Boolean).join('\n\n');
    return (userText ? '<div class="msg history-msg"><i class="user">WK</i><div><small>你</small><p>' + escapeHtml(userText).replace(/\n/g, '<br>') + '</p></div></div>' : '') + (agentText ? '<div class="msg history-msg"><i class="ai">✦</i><div class="agent-response"><small>Codex Flow</small><div class="markdown-body">' + markdownHtml(agentText) + '</div></div></div>' : '');
  }).join('');
  secureMarkdownLinks(byId('threadHistory'));
  byId('agentState').textContent = 'Codex Flow · 已恢复 · ' + (thread.name || thread.id.slice(0, 8));
  byId('thinking').classList.add('hide');
  const answer = agentItems.map(item => item.text).filter(Boolean).join('\n\n');
  renderMarkdown(answer || '该会话已恢复，可以继续输入新的问题。');
  latest?.items?.filter(item => !['userMessage', 'agentMessage', 'reasoning'].includes(item.type)).forEach(item => {
    addToolEvent({ itemType: item.type, text: appServerItemDescription(item), status: 'completed' });
    updateCollabItem(item);
  });
}

async function loadCodexSessions() {
  if (!bridge?.appServer || !publicConfig.configured) return;
  try {
    const response = await bridge.appServer.listThreads({ limit: 60, archived: byId('showArchivedSessions')?.checked, searchTerm: byId('sessionSearch')?.value.trim() || '' });
    codexThreads = response.data || [];
    byId('codexSessionsList').innerHTML = codexThreads.length ? codexThreads.map(thread => {
      const preview = cleanThreadPrompt(thread.preview) || '暂无预览';
      const title = cleanThreadPrompt(thread.name) || preview || '未命名会话';
      return '<article data-thread="' + thread.id + '" data-thread-name="' + escapeHtml(title.slice(0, 80)) + '"><span><b>' + escapeHtml(title.slice(0, 80)) + '</b><small>' + new Date(thread.updatedAt * 1000).toLocaleString('zh-CN') + ' · ' + escapeHtml(thread.modelProvider || '-') + (thread.forkedFromId ? ' · 已分叉' : '') + '</small><p>' + escapeHtml(preview.slice(0, 180)) + '</p></span><button data-session-action="resume">恢复</button><button data-session-action="rename">命名</button><button data-session-action="fork">分叉</button><button data-session-action="' + (byId('showArchivedSessions')?.checked ? 'unarchive' : 'archive') + '">' + (byId('showArchivedSessions')?.checked ? '取消归档' : '归档') + '</button><button class="danger" data-session-action="delete">删除</button></article>';
    }).join('') : '<p>当前范围没有 Codex 会话。</p>';
  } catch (error) {
    byId('codexSessionsList').innerHTML = '<p>' + escapeHtml(cleanError(error)) + '</p>';
  }
}

async function openCodexSessions() {
  modal('codexSessionsModal');
  await loadCodexSessions();
}

async function resumeCodexThread(threadId) {
  const response = await bridge.appServer.resumeThread({ threadId, model: byId('modelPicker').value, workspace: currentWorkspace, approvalPolicy: 'on-request' });
  renderCodexThread(response.thread);
  modal('codexSessionsModal', false);
  page('chat');
  toastMsg('Codex 会话已恢复');
}

async function forkCodexThread(threadId, turnId = null) {
  const response = await bridge.appServer.forkThread({ threadId, lastTurnId: turnId, model: byId('modelPicker').value, workspace: currentWorkspace, approvalPolicy: 'on-request' });
  renderCodexThread(response.thread);
  modal('codexSessionsModal', false);
  page('chat');
  toastMsg('已创建分叉会话');
}

byId('openCodexSessions').addEventListener('click', openCodexSessions);
document.querySelector('.session-quick').addEventListener('click', openCodexSessions);
byId('refreshCodexSessions').addEventListener('click', loadCodexSessions);
byId('showArchivedSessions').addEventListener('change', loadCodexSessions);
byId('sessionSearch').addEventListener('input', () => { clearTimeout(loadCodexSessions.timer); loadCodexSessions.timer = setTimeout(loadCodexSessions, 250); });
byId('codexSessionsList').addEventListener('click', async event => {
  const article = event.target.closest('[data-thread]');
  const action = event.target.closest('[data-session-action]')?.dataset.sessionAction;
  if (!article || !action) return;
  const threadId = article.dataset.thread;
  try {
    if (action === 'resume') await resumeCodexThread(threadId);
    if (action === 'fork') await forkCodexThread(threadId);
    if (action === 'rename') {
      const name = prompt('输入新的会话名称', article.dataset.threadName || '');
      if (name?.trim()) { await bridge.appServer.setThreadName({ threadId, name: name.trim() }); await loadCodexSessions(); }
    }
    if (action === 'archive') { await bridge.appServer.archiveThread(threadId); await loadCodexSessions(); }
    if (action === 'unarchive') { await bridge.appServer.unarchiveThread(threadId); await loadCodexSessions(); }
    if (action === 'delete' && confirm('永久删除这个 Codex 会话？此操作无法撤销。')) { await bridge.appServer.deleteThread(threadId); await loadCodexSessions(); }
  } catch (error) { toastMsg(cleanError(error)); }
});
byId('reviewCurrentThread').addEventListener('click', async () => {
  if (!currentThreadId) return toastMsg('请先开始或恢复一个 app-server 会话');
  try {
    prepareConversation('审查当前工作区未提交的代码改动', true);
    byId('thinking').textContent = '正在启动 Codex 代码审查...';
    document.querySelector('.composer').classList.add('busy');
    byId('interruptTurn').classList.remove('hide');
    const response = await bridge.appServer.startReview({ threadId: currentThreadId, target: { type: 'uncommittedChanges' }, delivery: 'inline' });
    currentTurnId = response.turn.id;
    lastTurnId = response.turn.id;
  } catch (error) {
    finishRequest();
    toastMsg(cleanError(error));
  }
});
byId('compactCurrentThread').addEventListener('click', async () => {
  if (!currentThreadId) return toastMsg('请先开始或恢复一个 app-server 会话');
  try {
    await bridge.appServer.compactThread(currentThreadId);
    toastMsg('正在压缩会话上下文，完成后可继续对话');
  } catch (error) { toastMsg(cleanError(error)); }
});
byId('renameCurrentThread').addEventListener('click', async () => {
  if (!currentThreadId) return toastMsg('请先开始或恢复一个 app-server 会话');
  const name = prompt('输入新的会话名称', currentThread?.name || '');
  if (!name?.trim()) return;
  try {
    await bridge.appServer.setThreadName({ threadId: currentThreadId, name: name.trim() });
    if (currentThread) currentThread.name = name.trim();
    byId('agentState').textContent = 'Codex Flow · ' + name.trim();
    toastMsg('会话名称已更新');
  } catch (error) { toastMsg(cleanError(error)); }
});
byId('forkCurrentThread').addEventListener('click', async () => { if (currentThreadId) await forkCodexThread(currentThreadId, lastTurnId); else toastMsg('当前不是 app-server 会话'); });
byId('archiveCurrentThread').addEventListener('click', async () => {
  if (!currentThreadId) return toastMsg('当前不是 app-server 会话');
  await bridge.appServer.archiveThread(currentThreadId);
  currentThreadId = null; currentThread = null; lastTurnId = null;
  byId('hero').classList.remove('hide'); byId('conversation').classList.add('hide');
  toastMsg('当前会话已归档');
});
document.querySelector('.new').addEventListener('click', () => {
  currentThreadId = null; currentThread = null; currentTurnId = null; lastTurnId = null;
  collabAgents.clear(); renderAgentGraph();
  byId('hero').classList.remove('hide'); byId('conversation').classList.add('hide');
  byId('prompt').value = ''; selectedImages = []; renderAttachmentPreview();
});


async function loadHistory() {
  if (!bridge) return;
  historySessions = await bridge.history.list(100);
  const recent = historySessions.slice(0, 8);
  byId('recentSessions').innerHTML = recent.length ? recent.map(session => '<button data-session="' + session.id + '"><i class="' + (session.source === 'video' ? 'orange' : session.source === 'schedule' ? 'green' : 'violet') + '"></i>' + escapeHtml(session.title || session.prompt.slice(0,24)) + '<small>' + new Date(session.createdAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) + '</small></button>').join('') : '<small>暂无历史任务</small>';
}

function openSession(session) {
  if (!session) return;
  page('chat');
  prepareConversation(session.prompt, false);
  byId('agentState').textContent = 'Codex Flow · 历史结果 · ' + (session.model || '未知模型');
  byId('thinking').classList.add('hide');
  renderMarkdown(session.response || '该历史任务没有保存文本结果。');
  modal('promptLibraryModal', false);
  modal('videoProjectsModal', false);
}

byId('recentSessions').addEventListener('click', event => openSession(historySessions.find(session => session.id === event.target.closest('[data-session]')?.dataset.session)));

async function loadPromptLibrary() {
  if (!bridge) return;
  [savedPrompts, historySessions] = await Promise.all([bridge.prompts.list(), bridge.history.list(100)]);
  const promptCards = savedPrompts.map(prompt => '<article><span><b>' + escapeHtml(prompt.title) + '</b><small>' + new Date(prompt.createdAt).toLocaleString('zh-CN') + '</small><p>' + escapeHtml(prompt.content) + '</p></span><button data-use-prompt="' + prompt.id + '">使用</button><button class="danger" data-delete-prompt="' + prompt.id + '">删除</button></article>');
  const sessionCards = historySessions.slice(0, 12).map(session => '<article><span><b>' + escapeHtml(session.title) + '</b><small>' + escapeHtml(session.source || 'chat') + ' · ' + new Date(session.createdAt).toLocaleString('zh-CN') + '</small><p>' + escapeHtml(session.prompt) + '</p></span><button data-open-session="' + session.id + '">打开</button></article>');
  byId('promptLibraryList').innerHTML = '<h3>已保存提示词</h3>' + (promptCards.join('') || '<p>暂无保存的提示词</p>') + '<h3>最近会话</h3>' + (sessionCards.join('') || '<p>暂无会话</p>');
}

async function openPromptLibrary() {
  await loadPromptLibrary();
  modal('promptLibraryModal');
}

byId('openPromptLibrary').addEventListener('click', openPromptLibrary);
byId('headerSearch').addEventListener('click', openPromptLibrary);
byId('headerTasks').addEventListener('click', () => page('tasks'));
byId('promptLibraryList').addEventListener('click', async event => {
  const useId = event.target.closest('[data-use-prompt]')?.dataset.usePrompt;
  const sessionId = event.target.closest('[data-open-session]')?.dataset.openSession;
  const deleteId = event.target.closest('[data-delete-prompt]')?.dataset.deletePrompt;
  if (useId) {
    const prompt = savedPrompts.find(item => item.id === useId);
    if (prompt) { modal('promptLibraryModal', false); page('chat'); byId('prompt').value = prompt.content; byId('prompt').focus(); }
  }
  if (sessionId) openSession(historySessions.find(session => session.id === sessionId));
  if (deleteId) { await bridge.prompts.remove(deleteId); await loadPromptLibrary(); toastMsg('提示词已删除'); }
});

async function handleQuickAction(button) {
  const text = button.textContent;
  if (text.includes('定时任务')) { byId('taskPrompt').value = byId('userText').textContent || byId('prompt').value; byId('taskName').value = (byId('userText').textContent || '新任务').slice(0,20); byId('newTask').click(); }
  if (text.includes('保存为提示词')) { await bridge.prompts.save({ content: byId('userText').textContent || byId('prompt').value, title: (byId('userText').textContent || '提示词').slice(0,30) }); toastMsg('提示词已保存到本地'); }
  if (text.includes('分享')) { const file = await bridge.conversation.export({ title: (byId('userText').textContent || '会话').slice(0,30), content: '# ' + (byId('userText').textContent || 'Codex Flow 会话') + '\n\n' + answerMarkdown }); if (file) toastMsg('会话已导出：' + file); }
}

byId('exportUsage').addEventListener('click', () => { const rows = ['时间,模型,输入Token,输出Token,总Token', ...usageRecords.map(r => [new Date(r.createdAt).toISOString(), r.modelId, r.inputTokens, r.outputTokens, r.totalTokens].map(v => '"' + String(v ?? '').replaceAll('"','""') + '"').join(','))]; const blob = new Blob(['\ufeff' + rows.join('\n')], { type:'text/csv;charset=utf-8' }); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='codex-flow-usage.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); });

byId('selectMedia').addEventListener('click', async () => { selectedMedia = await bridge.media.choose(); byId('mediaStatus').textContent = selectedMedia.length ? '已选择 ' + selectedMedia.length + ' 个素材：' + selectedMedia.map(path => path.split(/[\\/]/).pop()).join('、') : '未选择素材'; });
document.querySelectorAll('.video-option').forEach(button => button.addEventListener('click', () => {
  button.classList.toggle('active');
  const option = button.dataset.videoOption;
  const prompt = byId('videoPrompt');
  if (button.classList.contains('active') && !prompt.value.includes(option)) prompt.value += '\n' + option + '。';
}));
byId('startVideo').addEventListener('click', async () => {
  if (!publicConfig.configured) return modal('welcome');
  if (!selectedMedia.length) return toastMsg('请先选择视频、图片或音频素材');
  try { await bridge.extensions.install('remotion@openai-api-curated'); } catch (error) { toastMsg('Remotion 插件未自动安装，Agent 将尝试使用现有视频工具'); }
  currentWorkspace = selectedMedia[0].replace(/[\\/][^\\/]+$/, '');
  const title = '视频项目 · ' + new Date().toLocaleString('zh-CN');
  page('chat');
  byId('prompt').value = '请使用 Remotion、FFmpeg 或已安装的视频工具处理以下本地素材：\n' + selectedMedia.join('\n') + '\n\n剪辑要求：' + byId('videoPrompt').value + '\n请实际生成可播放视频文件，并在最终回答中明确输出路径、分辨率、时长和执行结果。';
  sendPrompt({ source: 'video', title });
});

async function loadVideoProjects() {
  if (!bridge) return;
  historySessions = await bridge.history.list(100);
  const projects = historySessions.filter(session => session.source === 'video');
  byId('videoProjectsList').innerHTML = projects.length ? projects.map(session => '<article><span><b>' + escapeHtml(session.title) + '</b><small>' + new Date(session.createdAt).toLocaleString('zh-CN') + ' · ' + escapeHtml(session.model || '-') + '</small><p>' + escapeHtml(session.prompt.slice(0, 180)) + '</p></span><button data-video-session="' + session.id + '">查看结果</button></article>').join('') : '<p>还没有视频项目。选择素材并开始智能剪辑后，项目会自动保存在这里。</p>';
}
byId('openVideoProjects').addEventListener('click', async () => { await loadVideoProjects(); modal('videoProjectsModal'); });
byId('videoProjectsList').addEventListener('click', event => openSession(historySessions.find(session => session.id === event.target.closest('[data-video-session]')?.dataset.videoSession)));

async function loadCliStatus() { if (!bridge) return; const [status, tasks, ext] = await Promise.all([bridge.agent.status(), bridge.tasks.summary(), bridge.extensions.list()]); byId('cliStatus').textContent = status.available ? status.version + ' · 可用' : 'Codex CLI 不可用'; byId('cliOutput').textContent = 'PS> codex-flow.cmd status\n' + (status.available ? '✓ ' + status.version : '✕ ' + (status.error || 'Codex CLI 不可用')) + '\n✓ 当前模型：' + (publicConfig.provider?.model || '未配置') + '\n✓ ' + ext.plugins.filter(p=>p.installed).length + ' 个插件已安装\n✓ ' + ext.mcpServers.filter(m=>m.enabled).length + ' 个 MCP 已启用\n✓ ' + tasks.running + ' 个定时任务运行中'; }
const cliGuides = {
  setup: 'npm.cmd install\nnpm.cmd link\ncodex-flow login\ncodex-flow status',
  chat: 'codex-flow chat\ncodex-flow chat "分析当前目录并给出修改建议"',
  schedule: 'codex-flow schedule list\ncodex-flow schedule toggle <任务ID>',
  models: 'codex-flow models\ncodex-flow model <模型ID>',
  extensions: 'codex plugin list --available\ncodex mcp list'
};
document.querySelectorAll('.cli-guide').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.cli-guide').forEach(item => item.classList.toggle('active', item === button));
  byId('cliOutput').textContent = 'PS> ' + cliGuides[button.dataset.cliSection].replaceAll('\n', '\nPS> ');
}));
byId('copyInstall').addEventListener('click', async () => { await navigator.clipboard.writeText('npm.cmd install && npm.cmd link'); toastMsg('安装命令已复制'); });
document.querySelectorAll('.copy-command').forEach(button => button.addEventListener('click', async () => { await navigator.clipboard.writeText(button.closest('p').querySelector('code').textContent); toastMsg('命令已复制'); }));

async function initialize() {
  loadTasks();
  loadHistory();
  renderProviders();
  if (!bridge) return;
  removeAgentListener = bridge.agent.onEvent(handleAgentEvent);
  removeTaskListener = bridge.tasks.onChanged(loadTasks);
  removeChatListener = bridge.chat.onEvent(handleChatEvent);
  removeAppServerEventListener = bridge.appServer.onEvent(handleAppServerEvent);
  removeAppServerRequestListener = bridge.appServer.onRequest(handleAppServerRequest);
  removeAppServerStatusListener = bridge.appServer.onStatus(status => {
    if (status.type === 'ready') document.querySelector('.connection').title = 'Codex app-server 已连接';
    if (status.type === 'stopped') document.querySelector('.connection').title = 'Codex app-server 已停止，将在下次请求时重启';
  });
  try {
    const [config, plans, status] = await Promise.all([bridge.config.getPublic(), bridge.codingPlans.list(), bridge.agent.status()]);
    publicConfig = config;
    codexStatus = status;
    for (const plan of plans) {
      codingPlanPresets[plan.name] = { baseUrl: plan.baseUrl, model: plan.defaultModel };
      const entry = providerCatalog.find(item => item[1] === plan.name);
      if (entry) {
        entry[2] = plan.baseUrl;
        entry[3] = plan.models.join(',');
      }
    }
    applyConfig();
    await loadUsage('month');
    if (publicConfig.configured) bridge.appServer.status().catch(() => {});
    if (publicConfig.configured) modal('welcome', false);
    if (!codexStatus.available) toastMsg('Codex 引擎不可用，将使用普通流式对话');
  } catch (error) {
    toastMsg(cleanError(error));
  }
}

window.addEventListener('beforeunload', () => {
  removeAgentListener?.();
  removeChatListener?.();
  removeTaskListener?.();
  removeAppServerEventListener?.();
  removeAppServerRequestListener?.();
  removeAppServerStatusListener?.();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    page('chat');
    byId('prompt').focus();
  }
  if (event.key === 'Escape') document.querySelectorAll('.modal.show').forEach(element => {
    if (element.id !== 'welcome' || publicConfig.configured) element.classList.remove('show');
  });
});

initialize();
