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

function renderMarkdown(markdown) {
  answerMarkdown = markdown || '';
  const answer = byId('answer');
  if (!answer) return;
  let html;
  if (window.marked && window.DOMPurify) {
    window.marked.setOptions({ gfm: true, breaks: true });
    html = window.DOMPurify.sanitize(window.marked.parse(answerMarkdown));
  } else {
    html = '<p>' + escapeHtml(answerMarkdown).replace(/\n/g, '<br>') + '</p>';
  }
  answer.innerHTML = html;
  answer.querySelectorAll('a[href]').forEach(link => {
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
  });
  answer.classList.remove('hide');
  byId('answerActions')?.classList.remove('hide');
}

function prepareConversation(prompt, agentMode = true) {
  byId('hero').classList.add('hide');
  byId('conversation').classList.remove('hide');
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
  byId('send').textContent = '↑';
  document.querySelector('.composer').classList.remove('busy');
  byId('thinking').classList.add('hide');
  byId('agentState').textContent = 'Codex Flow · 已完成';
  loadUsage('month');
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

async function runDirectChat(prompt) {
  activeRequestId = crypto.randomUUID();
  prepareConversation(prompt, false);
  document.querySelector('.composer').classList.add('busy');
  await bridge.chat.start({
    requestId: activeRequestId,
    model: byId('modelPicker').value,
    messages: [{ role: 'user', content: prompt }]
  });
}

async function sendPrompt() {
  const value = byId('prompt').value.trim();
  if (!value) return;
  if (activeRequestId && bridge) {
    await Promise.allSettled([bridge.agent.cancel(activeRequestId), bridge.chat.cancel(activeRequestId)]);
    return;
  }
  byId('prompt').value = '';
  if (!bridge || !publicConfig.configured) {
    prepareConversation(value, false);
    setTimeout(() => {
      renderMarkdown('## 演示模式\n\n连接 API Key 后，可使用真实 Codex Agent、联网搜索、Skills、MCP 和插件。');
      finishRequest();
    }, 600);
    return;
  }
  activeRequestId = crypto.randomUUID();
  const requestId = activeRequestId;
  prepareConversation(value, true);
  document.querySelector('.composer').classList.add('busy');
  try {
    if (!codexStatus.available) throw new Error(codexStatus.error || 'Codex 引擎不可用。');
    await bridge.agent.start({
      requestId,
      prompt: value,
      model: byId('modelPicker').value,
      workspace: currentWorkspace,
      webSearch: webEnabled
    });
  } catch (error) {
    if (activeRequestId !== requestId) return;
    activeRequestId = null;
    toastMsg('Codex Agent 不兼容当前接口，已回退到普通流式对话');
    try {
      await runDirectChat(value);
    } catch (fallbackError) {
      byId('thinking').textContent = cleanError(fallbackError);
      byId('thinking').classList.add('stream-error');
      finishRequest();
    }
  }
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

byId('webToggle').addEventListener('click', () => {
  webEnabled = !webEnabled;
  byId('webToggle').classList.toggle('active', webEnabled);
  byId('contextWebToggle')?.classList.toggle('on', webEnabled);
  toastMsg(webEnabled ? '已启用实时联网搜索' : '已关闭联网搜索');
});
byId('contextWebToggle')?.addEventListener('click', () => byId('webToggle').click());
byId('openTools').addEventListener('click', () => page('plugins'));
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
byId('answerSchedule')?.addEventListener('click', () => modal('taskModal'));

function renderTasks() {
  const tasks = [
    ['◉', '每日 AI 行业资讯', '每天 08:00:00', 'GPT-5.4', true],
    ['▤', '项目进度周报', '每周五 18:00:00', 'GLM-5.2', true],
    ['⌕', '竞品价格监控', '每小时 2 次', 'Doubao Seed Code', false]
  ];
  byId('taskList').innerHTML = tasks.map(task => '<div class="task-row"><i>' + task[0] + '</i><span><b>' + task[1] + '</b><p>' + task[2] + ' · ' + task[3] + '</p></span><small>下次执行：本地计划</small><button class="toggle ' + (task[4] ? 'on' : '') + '"><i></i></button><em>•••</em></div>').join('');
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
  const [summary, records] = await Promise.all([bridge.usage.summary(range), bridge.usage.list(20)]);
  byId('requests').textContent = Number(summary.requests).toLocaleString('zh-CN');
  byId('totalToken').textContent = Number(summary.totalTokens).toLocaleString('zh-CN');
  byId('totalCost').textContent = '¥' + Number(summary.estimatedCost || 0).toFixed(2);
  const max = Math.max(1, ...records.map(record => Number(record.totalTokens || 0)));
  byId('bars').innerHTML = records.length ? records.slice(0, 14).reverse().map(record => '<i style="height:' + Math.max(8, Math.round(Number(record.totalTokens || 0) / max * 100)) + '%" title="' + Number(record.totalTokens || 0).toLocaleString('zh-CN') + ' tokens"></i>').join('') : '<i style="height:8%"></i>';
  const rows = document.querySelector('.table-card tbody');
  if (rows) rows.innerHTML = records.slice(0, 8).map(record => '<tr><td>' + new Date(record.createdAt).toLocaleString('zh-CN') + '</td><td>' + escapeHtml(record.modelId || '-') + '</td><td>' + Number(record.inputTokens || 0).toLocaleString('zh-CN') + '</td><td>' + Number(record.outputTokens || 0).toLocaleString('zh-CN') + '</td><td>' + Number(record.totalTokens || 0).toLocaleString('zh-CN') + '</td><td>¥0.00</td></tr>').join('');
}

document.querySelectorAll('.ranges button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.ranges button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const map = { '今日': 'day', '本月': 'month', '今年': 'year', '全部': 'all' };
  loadUsage(map[button.textContent.trim()] || 'month');
}));

function extensionIcon(name) {
  if (/browser|chrome/.test(name)) return '◎';
  if (/github|code|web/.test(name)) return '▣';
  if (/image|figma|latex/.test(name)) return '✦';
  if (/video|remotion|game/.test(name)) return '▷';
  return '⌘';
}

function renderExtensions() {
  const query = byId('pluginSearch').value.trim().toLowerCase();
  const pluginCards = extensions.plugins.filter(plugin => {
    if (extensionFilter === 'installed' && !plugin.installed) return false;
    if (extensionFilter === 'mcp') return false;
    return !query || (plugin.name + ' ' + plugin.marketplace).toLowerCase().includes(query);
  }).map(plugin => {
    const description = pluginDescriptions[plugin.name] || '来自 ' + plugin.marketplace + ' 的 Codex 扩展，可为 Agent 增加专业工作流、工具或 Skills。';
    const button = plugin.installed
      ? '<button class="installed extension-action" data-action="remove" data-id="' + plugin.id + '">✓ 已安装</button>'
      : '<button class="install extension-action" data-action="install" data-id="' + plugin.id + '">安装</button>';
    return '<article class="plugin"><div class="plugin-head"><i>' + extensionIcon(plugin.name) + '</i>' + button + '</div><h3>' + escapeHtml(plugin.name) + '</h3><p>' + escapeHtml(description) + '</p><small>' + escapeHtml(plugin.marketplace) + (plugin.version ? ' · v' + escapeHtml(plugin.version) : '') + '</small></article>';
  });
  const mcpCards = extensions.mcpServers.filter(server => {
    if (extensionFilter === 'plugin') return false;
    if (extensionFilter === 'installed' && !server.enabled) return false;
    return !query || server.name.toLowerCase().includes(query);
  }).map(server => '<article class="plugin"><div class="plugin-head"><i>◆</i><button class="installed extension-action" data-action="remove-mcp" data-id="' + escapeHtml(server.name) + '">' + (server.enabled ? '✓ 已启用' : '已停用') + '</button></div><h3>' + escapeHtml(server.name) + '</h3><p>自定义 MCP 服务，通过 ' + escapeHtml(server.transport) + ' 向 Codex 提供实时工具和外部数据。</p><small>MCP · 授权状态 ' + escapeHtml(server.authStatus) + '</small></article>');
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

byId('newTask').addEventListener('click', () => modal('taskModal'));
byId('saveTask').addEventListener('click', () => {
  modal('taskModal', false);
  toastMsg('定时任务“' + byId('taskName').value + '”已创建');
});
byId('showKey').addEventListener('click', () => {
  byId('apiKey').type = byId('apiKey').type === 'password' ? 'text' : 'password';
});
byId('demo').addEventListener('click', () => {
  modal('welcome', false);
  toastMsg('已进入演示模式，连接 API Key 后可使用 Codex Agent');
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
  if (event.target.closest('.demo-action') || event.target.closest('.quick')) toastMsg('演示操作已执行');
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
  connection.innerHTML = '<i></i>' + (publicConfig.configured ? engine : '演示模式');
}

byId('modelPicker').addEventListener('change', async () => {
  if (bridge && publicConfig.configured) {
    publicConfig = await bridge.provider.setModel(byId('modelPicker').value);
    toastMsg('默认模型已切换');
  }
});

async function initialize() {
  renderTasks();
  renderProviders();
  if (!bridge) return;
  removeAgentListener = bridge.agent.onEvent(handleAgentEvent);
  removeChatListener = bridge.chat.onEvent(handleChatEvent);
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
    if (publicConfig.configured) modal('welcome', false);
    if (!codexStatus.available) toastMsg('Codex 引擎不可用，将使用普通流式对话');
  } catch (error) {
    toastMsg(cleanError(error));
  }
}

window.addEventListener('beforeunload', () => {
  removeAgentListener?.();
  removeChatListener?.();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    page('chat');
    byId('prompt').focus();
  }
  if (event.key === 'Escape') document.querySelectorAll('.modal.show').forEach(element => element.classList.remove('show'));
});

initialize();
