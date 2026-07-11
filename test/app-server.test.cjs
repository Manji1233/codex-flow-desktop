const test = require('node:test');
const assert = require('node:assert/strict');
const { AppServerService, buildAppServerArgs } = require('../electron/services/app-server-service.cjs');

test('app-server arguments configure a Responses-compatible custom provider', () => {
  const args = buildAppServerArgs({ name: '示例平台', baseUrl: 'https://example.com/v1' });
  assert.deepEqual(args.slice(-2), ['app-server', '--stdio']);
  assert.ok(args.includes('model_provider="codex_flow"'));
  assert.ok(args.includes('model_providers.codex_flow.base_url="https://example.com/v1"'));
  assert.ok(args.includes('model_providers.codex_flow.wire_api="responses"'));
  assert.ok(args.includes('model_providers.codex_flow.env_key="CODEX_FLOW_API_KEY"'));
  assert.ok(args.includes('sandbox_workspace_write.network_access=true'));
});

test('app-server correlates JSONL responses and forwards notifications', async () => {
  const notifications = [];
  const service = new AppServerService({ onNotification: notification => notifications.push(notification) });
  service.child = { stdin: { writable: true, write() {} } };
  const response = service.request('thread/read', { threadId: 'thread-1' });
  service.consume('{"method":"turn/started","params":{"threadId":"thread-1"}}\n');
  service.consume('{"id":"1","result":{"thread":{"id":"thread-1"}}}\n');
  assert.deepEqual(await response, { thread: { id: 'thread-1' } });
  assert.deepEqual(notifications, [{ method: 'turn/started', params: { threadId: 'thread-1' } }]);
});

test('app-server forwards server requests and serializes renderer responses', () => {
  const requests = [];
  const writes = [];
  const service = new AppServerService({ onServerRequest: request => requests.push(request) });
  service.child = { stdin: { writable: true, write: line => writes.push(JSON.parse(line)) } };
  service.consume('{"id":"approval-1","method":"item/commandExecution/requestApproval","params":{"command":"echo ok"}}\n');
  assert.deepEqual(requests, [{
    requestId: 'approval-1',
    method: 'item/commandExecution/requestApproval',
    params: { command: 'echo ok' }
  }]);
  service.respond('approval-1', { decision: 'accept' });
  assert.deepEqual(writes, [{ id: 'approval-1', result: { decision: 'accept' } }]);
  assert.throws(() => service.respond('approval-1', {}), /已失效/);
});

test('app-server serializes advanced thread and review requests', async () => {
  const writes = [];
  const service = new AppServerService();
  service.child = { stdin: { writable: true, write: line => writes.push(JSON.parse(line)) } };
  const deletion = service.request('thread/delete', { threadId: 'thread-1' });
  service.consume('{"id":"1","result":{}}\n');
  await deletion;
  const review = service.request('review/start', { threadId: 'thread-1', target: { type: 'uncommittedChanges' }, delivery: 'inline' });
  service.consume('{"id":"2","result":{"reviewThreadId":"thread-1","turn":{"id":"turn-1"}}}\n');
  await review;
  assert.deepEqual(writes, [
    { id: '1', method: 'thread/delete', params: { threadId: 'thread-1' } },
    { id: '2', method: 'review/start', params: { threadId: 'thread-1', target: { type: 'uncommittedChanges' }, delivery: 'inline' } }
  ]);
});
