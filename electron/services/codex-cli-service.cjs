const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PLATFORM_PACKAGES = {
  'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
  'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
  'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
  'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
  'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex']
};

function findCodexExecutable() {
  const configured = process.env.CODEX_CLI_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  const target = PLATFORM_PACKAGES[process.platform + '-' + process.arch];
  if (!target) throw new Error('当前系统架构暂不支持内置 Codex 引擎。');
  try {
    const packagePath = require.resolve(target[0] + '/package.json');
    const executable = path.join(path.dirname(packagePath), 'vendor', target[1], 'bin', target[2]);
    if (fs.existsSync(executable)) return executable;
  } catch {}
  throw new Error('未找到 Codex 引擎，请重新执行 npm install。');
}

function runCommand(args, options = {}) {
  const executable = findCodexExecutable();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(cleanCliError(stderr || stdout || 'Codex 命令执行失败。')));
    });
    child.stdin.end();
    options.onChild?.(child);
  });
}

function cleanCliError(message) {
  const lines = String(message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const useful = lines.filter(line => !/^\d{4}-\d{2}-\d{2}T/.test(line) && !/^WARN\b/.test(line));
  return (useful.slice(-4).join('\n') || lines.slice(-2).join('\n') || 'Codex 命令执行失败。').slice(0, 1200);
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

const ICON_MIME_TYPES = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
};

const BUILT_IN_BRAND_ICONS = [
  { pattern: /小红书|xiaohongshu|rednote/i, file: 'xiaohongshu.svg' },
  { pattern: /twitter|推特|x\.com/i, file: 'x.svg' },
  { pattern: /tiktok|tik tok|抖音|douyin/i, file: 'tiktok.svg' },
  { pattern: /新浪微博|微博|sinaweibo|weibo/i, file: 'weibo.svg' },
  { pattern: /youtube|油管/i, file: 'youtube.svg' },
  { pattern: /instagram/i, file: 'instagram.svg' }
];

function pluginCacheRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'plugins', 'cache');
}

function pluginManifestPaths(plugin, cacheRoot = pluginCacheRoot()) {
  const pluginDirectory = path.join(cacheRoot, plugin.marketplaceName || '', plugin.name || '');
  if (!fs.existsSync(pluginDirectory)) return [];
  const directManifest = path.join(pluginDirectory, '.codex-plugin', 'plugin.json');
  const manifests = fs.existsSync(directManifest) ? [directManifest] : [];
  for (const entry of fs.readdirSync(pluginDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(pluginDirectory, entry.name, '.codex-plugin', 'plugin.json');
    if (fs.existsSync(manifestPath)) manifests.push(manifestPath);
  }
  return manifests;
}

function pluginPresentation(plugin, cacheRoot) {
  const candidates = pluginManifestPaths(plugin, cacheRoot).map(manifestPath => {
    try {
      return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
    } catch {
      return null;
    }
  }).filter(Boolean).sort((left, right) => Number(right.manifest.version === plugin.version) - Number(left.manifest.version === plugin.version));
  const selected = candidates[0];
  if (!selected) return {};
  const details = selected.manifest.interface || {};
  const presentation = {
    displayName: details.displayName || selected.manifest.name || plugin.name,
    description: details.shortDescription || selected.manifest.description || '',
    brandColor: /^#[0-9a-f]{3,8}$/i.test(details.brandColor || '') ? details.brandColor : ''
  };
  const iconReference = details.logo || details.composerIcon;
  if (!iconReference) return presentation;
  const pluginRoot = path.dirname(path.dirname(selected.manifestPath));
  const iconPath = path.resolve(pluginRoot, iconReference);
  const relativeIconPath = path.relative(pluginRoot, iconPath);
  const mimeType = ICON_MIME_TYPES[path.extname(iconPath).toLowerCase()];
  if (!mimeType || relativeIconPath.startsWith('..') || path.isAbsolute(relativeIconPath) || !fs.existsSync(iconPath)) return presentation;
  const icon = fs.readFileSync(iconPath);
  if (icon.length > 512 * 1024) return presentation;
  presentation.iconDataUrl = 'data:' + mimeType + ';base64,' + icon.toString('base64');
  return presentation;
}

function builtInBrandPresentation(plugin) {
  const names = [plugin.name, plugin.displayName].filter(Boolean).map(value => String(value).trim());
  const identity = [...names, plugin.description].filter(Boolean).join(' ');
  const brand = BUILT_IN_BRAND_ICONS.find(item => item.pattern.test(identity))
    || (names.some(name => /^x$/i.test(name)) ? { file: 'x.svg' } : null);
  if (!brand) return {};
  try {
    const icon = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'brand-icons', brand.file));
    return { iconDataUrl: 'data:image/svg+xml;base64,' + icon.toString('base64'), brandColor: '#ffffff' };
  } catch {
    return {};
  }
}

function pluginSummary(plugin, cacheRoot) {
  const presentation = pluginPresentation(plugin, cacheRoot);
  const builtInBrand = presentation.iconDataUrl ? {} : builtInBrandPresentation({ ...plugin, ...presentation });
  return {
    id: plugin.pluginId,
    name: plugin.name,
    marketplace: plugin.marketplaceName,
    version: plugin.version || '',
    installed: Boolean(plugin.installed),
    enabled: Boolean(plugin.enabled),
    authPolicy: plugin.authPolicy || 'ON_USE',
    ...presentation,
    ...builtInBrand,
    brandColor: builtInBrand.iconDataUrl ? builtInBrand.brandColor : presentation.brandColor
  };
}

async function getStatus() {
  try {
    const { stdout } = await runCommand(['--version']);
    return { available: true, version: stdout.trim(), executable: path.basename(findCodexExecutable()) };
  } catch (error) {
    return { available: false, version: '', error: error.message };
  }
}

function normalizeVersion(value) {
  return String(value || '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] || '';
}

function compareVersions(left, right) {
  const parse = value => normalizeVersion(value).split(/[.-]/).slice(0, 3).map(part => Number(part) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

async function getDiagnostics() {
  const status = await getStatus();
  const installedVersion = normalizeVersion(status.version);
  let latestVersion = '';
  let updateError = null;
  try {
    const response = await fetch('https://registry.npmjs.org/@openai%2Fcodex/latest', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    latestVersion = normalizeVersion((await response.json()).version);
  } catch (error) {
    updateError = error.message;
  }
  return {
    ...status,
    productName: 'ChatGPT Codex',
    installedVersion,
    latestVersion,
    upToDate: Boolean(installedVersion && latestVersion && compareVersions(installedVersion, latestVersion) >= 0),
    releaseChannel: 'stable',
    updateError,
    protocol: 'app-server v2',
    capabilities: ['API Key / ChatGPT 切换', '模型能力控制', '持久会话', '交互审批', '联网搜索', 'Skills 与 MCP', '图片附件', '多代理', 'Diff', 'Plan', 'PTY 终端']
  };
}

async function listExtensions() {
  const [{ stdout: pluginOutput }, { stdout: mcpOutput }] = await Promise.all([
    runCommand(['plugin', 'list', '--available', '--json']),
    runCommand(['mcp', 'list', '--json'])
  ]);
  const plugins = parseJson(pluginOutput, { installed: [], available: [] });
  const mcpServers = parseJson(mcpOutput, []);
  return {
    plugins: [...(plugins.installed || []), ...(plugins.available || [])].map(plugin => pluginSummary(plugin)),
    mcpServers: mcpServers.map(server => ({
      id: 'mcp:' + server.name,
      name: server.name,
      enabled: Boolean(server.enabled),
      authStatus: server.auth_status || 'unknown',
      transport: server.transport?.type || 'unknown'
    }))
  };
}

function validatePluginId(pluginId) {
  if (!/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/i.test(pluginId || '')) {
    throw new Error('插件标识无效。');
  }
}

async function installPlugin(pluginId) {
  validatePluginId(pluginId);
  const { stdout } = await runCommand(['plugin', 'add', pluginId, '--json']);
  return parseJson(stdout, { success: true, pluginId });
}

async function removePlugin(pluginId) {
  validatePluginId(pluginId);
  const { stdout } = await runCommand(['plugin', 'remove', pluginId, '--json']);
  return parseJson(stdout, { success: true, pluginId });
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function eventDescription(item) {
  const type = item?.type || '';
  if (type === 'web_search') return '正在联网搜索';
  if (type === 'command_execution') return item.command ? '执行命令：' + item.command : '正在执行终端命令';
  if (type === 'mcp_tool_call') return '调用 MCP：' + (item.server || item.name || '工具');
  if (type === 'reasoning') return '正在分析任务';
  if (type === 'file_change') return '正在修改工作区文件';
  if (type === 'todo_list') return '正在更新任务计划';
  if (type === 'error') return item.message || 'Codex 执行出现错误';
  return type ? '正在执行：' + type.replaceAll('_', ' ') : '正在处理任务';
}

function validateMcpName(name) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name || '')) throw new Error('MCP 名称无效。');
}

async function addMcp(payload) {
  validateMcpName(payload?.name);
  const args = ['mcp', 'add', payload.name];
  if (payload.type === 'url') {
    const url = new URL(payload.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL 只支持 HTTP 或 HTTPS。');
    args.push('--url', url.toString());
  } else {
    if (!payload.command?.trim()) throw new Error('请输入 MCP 启动命令。');
    args.push('--', payload.command.trim(), ...(payload.args || []).filter(Boolean));
  }
  await runCommand(args);
  return { success: true, name: payload.name };
}

async function removeMcp(name) {
  validateMcpName(name);
  await runCommand(['mcp', 'remove', name]);
  return { success: true, name };
}

async function runAgent({ provider, model, prompt, workspace, webSearch, onEvent, onChild }) {
  const args = [];
  if (webSearch) args.push('--search');
  args.push('-a', 'never');
  if (model) args.push('-m', model);
  if (provider?.authMode !== 'chatgpt') args.push(
    '-c', 'model_provider="codex_flow"',
    '-c', 'model_providers.codex_flow.name=' + tomlString(provider.name || 'ChatGPT Codex'),
    '-c', 'model_providers.codex_flow.base_url=' + tomlString(provider.baseUrl),
    '-c', 'model_providers.codex_flow.env_key="CODEX_FLOW_API_KEY"',
    '-c', 'model_providers.codex_flow.wire_api="responses"',
    '-c', 'model_providers.codex_flow.requires_openai_auth=false'
  );
  args.push(
    '-c', 'sandbox_workspace_write.network_access=true',
    'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', workspace, prompt
  );

  let lineBuffer = '';
  let finalMessage = '';
  let usage = null;
  const processLine = line => {
    const event = parseJson(line, null);
    if (!event) return;
    if (event.type === 'thread.started') onEvent({ type: 'thread', threadId: event.thread_id });
    if (event.type === 'turn.started') onEvent({ type: 'status', text: 'Codex 已开始执行任务' });
    if (event.type === 'item.started' || event.type === 'item.completed') {
      const item = event.item || {};
      if (item.type === 'error' && /Model metadata .* not found/i.test(item.message || '')) return;
      if (item.type === 'agent_message' && item.text) {
        finalMessage = item.text;
        onEvent({ type: 'message', markdown: item.text });
      } else {
        onEvent({ type: 'tool', status: event.type === 'item.completed' ? 'completed' : 'running', itemType: item.type, text: eventDescription(item) });
      }
    }
    if (event.type === 'turn.completed') {
      usage = event.usage || null;
      onEvent({ type: 'status', text: '任务执行完成' });
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      onEvent({ type: 'error', message: event.error?.message || event.message || 'Codex 执行失败。' });
    }
  };

  await runCommand(args, {
    cwd: workspace,
    env: provider?.authMode === 'chatgpt' ? undefined : { CODEX_FLOW_API_KEY: provider.apiKey },
    onChild,
    onStdout: chunk => {
      lineBuffer += chunk;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      lines.filter(Boolean).forEach(processLine);
    }
  });
  if (lineBuffer.trim()) processLine(lineBuffer.trim());
  if (!finalMessage) throw new Error('Codex 没有返回最终消息。');
  return { finalMessage, usage };
}

module.exports = {
  findCodexExecutable,
  getStatus,
  getDiagnostics,
  listExtensions,
  installPlugin,
  removePlugin,
  addMcp,
  removeMcp,
  runAgent,
  cleanCliError,
  pluginSummary,
  pluginPresentation,
  builtInBrandPresentation,
  normalizeVersion,
  compareVersions
};
