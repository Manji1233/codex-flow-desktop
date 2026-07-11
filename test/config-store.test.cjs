const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore } = require('../electron/services/config-store.cjs');

test('API Key remains the default mode for existing configurations', () => {
  const store = new ConfigStore('unused');
  store.state = {
    authMode: null,
    provider: { id: 'demo', name: '示例平台', baseUrl: 'https://example.com/v1', model: 'demo-model', models: [{ id: 'demo-model' }], encryptedApiKey: 'encrypted' },
    chatgpt: null
  };
  const config = store.publicConfig();
  assert.equal(config.authMode, 'apiKey');
  assert.equal(config.provider.model, 'demo-model');
  assert.deepEqual(config.availableModes, { apiKey: true, chatgpt: false });
});

test('ChatGPT mode keeps the saved API provider available for switching back', () => {
  const store = new ConfigStore('unused');
  store.state = {
    authMode: 'chatgpt',
    provider: { id: 'demo', name: '示例平台', baseUrl: 'https://example.com/v1', model: 'demo-model', models: [{ id: 'demo-model' }], encryptedApiKey: 'encrypted' },
    chatgpt: { account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' }, model: 'gpt-codex', models: [{ id: 'gpt-codex' }] }
  };
  const config = store.publicConfig();
  assert.equal(config.authMode, 'chatgpt');
  assert.equal(config.provider.name, 'ChatGPT Codex');
  assert.equal(config.savedProvider.name, '示例平台');
  assert.deepEqual(config.availableModes, { apiKey: true, chatgpt: true });
  assert.equal(store.getProviderWithSecret().authMode, 'chatgpt');
});
