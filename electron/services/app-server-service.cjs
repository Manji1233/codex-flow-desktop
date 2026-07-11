const { spawn } = require('node:child_process');
const { findCodexExecutable } = require('./codex-cli-service.cjs');

function tomlString(value) {
  return JSON.stringify(String(value));
}

function providerSignature(provider) {
  if (provider?.authMode === 'chatgpt') return JSON.stringify({ authMode: 'chatgpt' });
  return JSON.stringify({ authMode: 'apiKey', name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey });
}

function buildAppServerArgs(provider) {
  const commonArgs = ['-c', 'sandbox_workspace_write.network_access=true', 'app-server', '--stdio'];
  if (provider?.authMode === 'chatgpt') return commonArgs;
  return [
    '-c', 'model_provider="codex_flow"',
    '-c', 'model_providers.codex_flow.name=' + tomlString(provider.name || 'ChatGPT Codex'),
    '-c', 'model_providers.codex_flow.base_url=' + tomlString(provider.baseUrl),
    '-c', 'model_providers.codex_flow.env_key="CODEX_FLOW_API_KEY"',
    '-c', 'model_providers.codex_flow.wire_api="responses"',
    '-c', 'model_providers.codex_flow.requires_openai_auth=false',
    ...commonArgs
  ];
}

class AppServerService {
  constructor({ onNotification, onServerRequest, onStatus } = {}) {
    this.onNotification = onNotification || (() => {});
    this.onServerRequest = onServerRequest || (() => {});
    this.onStatus = onStatus || (() => {});
    this.child = null;
    this.signature = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.startPromise = null;
  }

  async ensure(provider) {
    const signature = providerSignature(provider);
    if (this.child && this.signature === signature) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start(provider, signature).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async start(provider, signature = providerSignature(provider)) {
    this.stop();
    const child = spawn(findCodexExecutable(), buildAppServerArgs(provider), {
      cwd: process.cwd(),
      env: provider?.authMode === 'chatgpt' ? { ...process.env } : { ...process.env, CODEX_FLOW_API_KEY: provider.apiKey },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    this.signature = signature;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.consume(chunk));
    child.stderr.on('data', chunk => {
      const line = String(chunk).trim();
      if (line && !/remote .*plugin|featured plugin|authentication required/i.test(line)) this.onStatus({ type: 'stderr', message: line.slice(0, 1200) });
    });
    child.on('error', error => this.failAll(error));
    child.on('exit', code => {
      if (this.child !== child) return;
      this.child = null;
      this.signature = null;
      this.failAll(new Error('Codex app-server 已退出' + (code === null ? '。' : '，退出码 ' + code + '。')));
      this.onStatus({ type: 'stopped', code });
    });
    await this.request('initialize', {
      clientInfo: { name: 'codex-flow-desktop', title: 'ChatGPT Codex', version: '0.3.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    }, false);
    this.notify('initialized', {});
    this.onStatus({ type: 'ready' });
  }

  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) pending.reject(new Error(message.error.message || 'app-server 请求失败。'));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      const requestId = String(message.id);
      this.serverRequests.set(requestId, message);
      this.onServerRequest({ requestId, method: message.method, params: message.params || {} });
      return;
    }
    if (message.method) this.onNotification({ method: message.method, params: message.params || {} });
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server 尚未启动。');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  notify(method, params) {
    this.send({ method, params });
  }

  request(method, params = {}, ensureReady = true) {
    if (ensureReady && !this.child) return Promise.reject(new Error('Codex app-server 尚未启动。'));
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try { this.send({ id, method, params }); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  respond(requestId, result, error) {
    if (!this.serverRequests.has(String(requestId))) throw new Error('交互请求已失效。');
    this.serverRequests.delete(String(requestId));
    this.send(error ? { id: requestId, error } : { id: requestId, result });
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.serverRequests.clear();
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.signature = null;
    if (child && !child.killed) child.kill();
  }
}

module.exports = { AppServerService, buildAppServerArgs };
