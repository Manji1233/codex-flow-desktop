function normalizeBaseUrl(baseUrl) {
  let normalized = String(baseUrl || '').trim();
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function endpoint(baseUrl, route) {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized + route;
}

function authHeaders(apiKey) {
  return { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
}

async function parseError(response) {
  const text = await response.text();
  let message = text || response.statusText;
  try {
    const body = JSON.parse(text);
    message = body.error?.message || body.message || text;
  } catch {}
  if (message.includes('does not support the coding plan feature')) {
    return '当前模型不支持火山方舟 Coding Plan。请切换为 ark-code-latest，或选择 Coding Plan 列表中的代码模型。';
  }
  return message;
}

async function discoverModels(provider, signal) {
  const response = await fetch(endpoint(provider.baseUrl, '/models'), { headers: authHeaders(provider.apiKey), signal });
  if (!response.ok) throw new Error('模型发现失败：' + await parseError(response));
  const body = await response.json();
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  return items.map(item => ({ id: item.id || item.name, ownedBy: item.owned_by || item.ownedBy || '' })).filter(item => item.id).sort((a, b) => a.id.localeCompare(b.id));
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil([...String(text || '')].length / 3));
}

async function streamChat({ provider, model, messages, signal, onEvent }) {
  const startedAt = new Date().toISOString();
  const response = await fetch(endpoint(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
    signal
  });
  if (!response.ok) throw new Error('对话请求失败：' + await parseError(response));
  if (!response.body) throw new Error('服务商没有返回可读取的数据流。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        output += delta;
        onEvent({ type: 'delta', text: delta });
      }
      if (json.usage) usage = json.usage;
    }
  }

  const inputText = messages.map(message => message.content || '').join('\n');
  const inputTokens = usage?.prompt_tokens ?? estimateTokens(inputText);
  const outputTokens = usage?.completion_tokens ?? estimateTokens(output);
  return {
    output,
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
    estimated: !usage,
    startedAt,
    finishedAt: new Date().toISOString()
  };
}

module.exports = { discoverModels, streamChat };
