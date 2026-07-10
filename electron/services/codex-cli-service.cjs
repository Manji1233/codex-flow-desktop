const fs = require('node:fs');
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

function pluginSummary(plugin) {
  return {
    id: plugin.pluginId,
    name: plugin.name,
    marketplace: plugin.marketplaceName,
    version: plugin.version || '',
    installed: Boolean(plugin.installed),
    enabled: Boolean(plugin.enabled),
    authPolicy: plugin.authPolicy || 'ON_USE'
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

async function listExtensions() {
  const [{ stdout: pluginOutput }, { stdout: mcpOutput }] = await Promise.all([
    runCommand(['plugin', 'list', '--available', '--json']),
    runCommand(['mcp', 'list', '--json'])
  ]);
  const plugins = parseJson(pluginOutput, { installed: [], available: [] });
  const mcpServers = parseJson(mcpOutput, []);
  return {
    plugins: [...(plugins.installed || []), ...(plugins.available || [])].map(pluginSummary),
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
  args.push(
    '-a', 'never',
    '-m', model,
    '-c', 'model_provider="codex_flow"',
    '-c', 'model_providers.codex_flow.name=' + tomlString(provider.name || 'Codex Flow'),
    '-c', 'model_providers.codex_flow.base_url=' + tomlString(provider.baseUrl),
    '-c', 'model_providers.codex_flow.env_key="CODEX_FLOW_API_KEY"',
    '-c', 'model_providers.codex_flow.wire_api="responses"',
    '-c', 'model_providers.codex_flow.requires_openai_auth=false',
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
    env: { CODEX_FLOW_API_KEY: provider.apiKey },
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
  listExtensions,
  installPlugin,
  removePlugin,
  addMcp,
  removeMcp,
  runAgent,
  cleanCliError
};
