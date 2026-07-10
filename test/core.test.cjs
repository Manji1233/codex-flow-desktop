const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { discoverModels, streamChat } = require('../electron/services/openai-client.cjs');
const { UsageStore } = require('../electron/services/usage-store.cjs');

async function createMockServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/custom/openai/models') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-reasoner' }] }));
      return;
    }
    if (request.url === '/custom/openai/chat/completions') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '你好' } }] }) + '\n\n');
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '，世界' } }] }) + '\n\n');
      response.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } }) + '\n\n');
      response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('model discovery, streaming chat and usage storage', async t => {
  const server = await createMockServer();
  t.after(() => server.close());
  const address = server.address();
  const provider = { baseUrl: 'http://127.0.0.1:' + address.port + '/custom/openai', apiKey: 'mock' };
  const models = await discoverModels(provider);
  assert.deepEqual(models.map(item => item.id), ['mock-chat', 'mock-reasoner']);

  let streamed = '';
  const result = await streamChat({
    provider,
    model: 'mock-chat',
    messages: [{ role: 'user', content: '打招呼' }],
    onEvent: event => { if (event.type === 'delta') streamed += event.text; }
  });
  assert.equal(streamed, '你好，世界');
  assert.equal(result.totalTokens, 12);
  assert.equal(result.estimated, false);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-flow-'));
  const store = new UsageStore(tempDir);
  await store.load();
  await store.add({ inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0, createdAt: new Date().toISOString() });
  assert.deepEqual(store.summary('day'), { range: 'day', requests: 1, inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 });
});


test('coding plan incompatible model returns actionable message', async t => {
  const server = http.createServer((_request, response) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'The requested model does not support the coding plan feature.' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  await assert.rejects(
    streamChat({
      provider: { baseUrl: 'http://127.0.0.1:' + address.port, apiKey: 'mock' },
      model: 'unsupported-model',
      messages: [{ role: 'user', content: 'hello' }],
      onEvent: () => {}
    }),
    /ark-code-latest/
  );
});
