const readline = require('node:readline');
const { app } = require('electron');
const { ConfigStore } = require('./services/config-store.cjs');
const { UsageStore } = require('./services/usage-store.cjs');
const { discoverModels, streamChat } = require('./services/openai-client.cjs');
const { CODING_PLANS, getCodingPlan, normalizeCodingPlanModels, chooseCodingPlanModel } = require('./services/coding-plans.cjs');

app.setName('codex-flow-desktop');

const colorsEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const color = (code, text) => colorsEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
const muted = text => color('2', text);
const accent = text => color('36', text);
const success = text => color('32', text);
const warning = text => color('33', text);
const failure = text => color('31', text);

function printHelp() {
  console.log(`
${accent('Codex Flow')} - 简单的多模型终端 AI 客户端

用法:
  codex-flow login                 配置 API Key、平台和模型
  codex-flow status                查看当前连接状态
  codex-flow models                刷新并列出可用模型
  codex-flow model <模型 ID>       切换当前模型
  codex-flow chat [提示词]         单次提问或进入持续对话
  codex-flow usage [范围]          查看 Token 用量（day/month/year/all）
  codex-flow logout                清除本地 API 配置
  codex-flow help                  显示帮助

login 可选参数:
  --plan <ID>                      直接选择 Coding Plan
  --base-url <URL>                 使用自定义 OpenAI 兼容接口
  --api-key <KEY>                  非交互输入 API Key（不推荐）
  --model <ID>                     接口不支持 /models 时手动指定模型

持续对话命令:
  /help  /model <ID>  /usage  /clear  /exit
`);
}

function parseOptions(args) {
  const options = { positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      options.positional.push(value);
      continue;
    }
    const [rawKey, inlineValue] = value.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) options[key] = inlineValue;
    else if (args[index + 1] && !args[index + 1].startsWith('--')) options[key] = args[++index];
    else options[key] = true;
  }
  return options;
}

function createPrompt() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, defaultValue = '') {
  const suffix = defaultValue ? ` ${muted(`[${defaultValue}]`)}` : '';
  return new Promise(resolve => rl.question(`${question}${suffix}: `, answer => resolve(answer.trim() || defaultValue)));
}

function askSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = createPrompt();
    return ask(rl, question).finally(() => rl.close());
  }
  return new Promise(resolve => {
    let value = '';
    process.stdout.write(`${question}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = character => {
      if (character === '\r' || character === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (character === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        process.exit(130);
      }
      if (character === '\u0008' || character === '\u007f') {
        if (value) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (character >= ' ') {
        value += character;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

function printProvider(config) {
  if (!config.configured || !config.provider) {
    console.log(warning('尚未配置 API Key，请运行 codex-flow login。'));
    return false;
  }
  const provider = config.provider;
  console.log(`${success('● 已连接')}  ${provider.name}`);
  console.log(`  API 地址  ${provider.baseUrl}`);
  console.log(`  当前模型  ${accent(provider.model || '未选择')}`);
  console.log(`  模型数量  ${provider.models.length}`);
  console.log(`  更新时间  ${new Date(provider.updatedAt).toLocaleString('zh-CN')}`);
  return true;
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function printUsage(summary) {
  const labels = { day: '今日', month: '本月', year: '今年', all: '全部' };
  console.log(`${accent(labels[summary.range] || summary.range)} Token 用量`);
  console.log(`  请求次数   ${formatNumber(summary.requests)}`);
  console.log(`  输入 Token ${formatNumber(summary.inputTokens)}`);
  console.log(`  输出 Token ${formatNumber(summary.outputTokens)}`);
  console.log(`  总 Token   ${formatNumber(summary.totalTokens)}`);
}

async function discoverProviderModels(provider, manualModel) {
  let models = [];
  let discoveryError = null;
  try {
    models = await discoverModels(provider);
  } catch (error) {
    discoveryError = error;
  }
  const codingPlan = getCodingPlan(provider.baseUrl);
  if (codingPlan) models = normalizeCodingPlanModels(codingPlan, models);
  if (!models.length && manualModel) models = [{ id: manualModel, ownedBy: 'manual' }];
  if (!models.length) {
    const reason = discoveryError?.message || '接口没有返回可用模型';
    throw new Error(`${reason}。如果接口不支持 /models，请使用 --model 指定模型 ID。`);
  }
  const model = codingPlan
    ? chooseCodingPlanModel(codingPlan, models, manualModel)
    : manualModel && models.some(item => item.id === manualModel) ? manualModel : models[0].id;
  return { models, model, discoveryError };
}

async function login(configStore, args) {
  const options = parseOptions(args);
  let plan = options.plan ? CODING_PLANS.find(item => item.id === options.plan) : null;
  let baseUrl = options.baseUrl;
  let providerName = '自定义 OpenAI 兼容接口';

  if (options.plan && !plan) throw new Error(`未知 Coding Plan：${options.plan}。`);
  if (!baseUrl && !plan) {
    const rl = createPrompt();
    console.log(accent('\n选择模型平台'));
    CODING_PLANS.forEach((item, index) => console.log(`  ${index + 1}. ${item.name}  ${muted(item.baseUrl)}`));
    console.log(`  ${CODING_PLANS.length + 1}. 自定义 OpenAI 兼容接口`);
    const selected = Number(await ask(rl, '请输入序号', String(CODING_PLANS.length + 1)));
    if (selected >= 1 && selected <= CODING_PLANS.length) plan = CODING_PLANS[selected - 1];
    else baseUrl = await ask(rl, 'API Base URL', 'https://api.openai.com/v1');
    rl.close();
  }

  if (plan) {
    baseUrl = plan.baseUrl;
    providerName = plan.name;
  }
  if (!baseUrl) throw new Error('请提供有效的 API Base URL。');
  const apiKey = String(options.apiKey || await askSecret('请输入 API Key')).trim();
  if (!apiKey) throw new Error('API Key 不能为空。');

  console.log(muted('正在发现可用模型...'));
  const provider = { id: plan?.id || 'openai-compatible', name: providerName, baseUrl, apiKey };
  const result = await discoverProviderModels(provider, options.model);
  await configStore.saveProvider({ ...provider, model: result.model, models: result.models });
  console.log(success(`配置完成，已选择 ${result.model}，发现 ${result.models.length} 个模型。`));
  if (result.discoveryError && plan) console.log(warning('平台模型接口不可用，已载入内置 Coding Plan 模型列表。'));
}

async function listModels(configStore) {
  const provider = configStore.getProviderWithSecret();
  console.log(muted('正在刷新模型列表...'));
  const result = await discoverProviderModels(provider, provider.model);
  await configStore.updateModels(result.models, result.model);
  for (const model of result.models) {
    const marker = model.id === result.model ? success('●') : ' ';
    console.log(`${marker} ${model.id}${model.ownedBy ? muted(`  ${model.ownedBy}`) : ''}`);
  }
  if (result.discoveryError) console.log(warning('实时发现失败，当前显示内置或已指定的模型。'));
}

async function setModel(configStore, modelId) {
  if (!modelId) throw new Error('请指定模型 ID，例如 codex-flow model glm-5.2。');
  const config = configStore.publicConfig();
  if (!config.configured) throw new Error('请先运行 codex-flow login。');
  const models = [...(config.provider.models || [])];
  if (!models.some(model => model.id === modelId)) models.push({ id: modelId, ownedBy: 'manual' });
  await configStore.updateModels(models, modelId);
  console.log(success(`当前模型已切换为 ${modelId}。`));
}

async function runChatRequest({ configStore, usageStore, messages }) {
  const provider = configStore.getProviderWithSecret();
  if (!provider.model) throw new Error('尚未选择模型，请运行 codex-flow models 或 codex-flow model <ID>。');
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);
  process.stdout.write(`${accent(provider.model)} ${muted('›')} `);
  try {
    const result = await streamChat({
      provider,
      model: provider.model,
      messages,
      signal: controller.signal,
      onEvent: event => {
        if (event.type === 'delta') process.stdout.write(event.text);
      }
    });
    process.stdout.write('\n');
    await usageStore.add({
      requestId,
      providerId: provider.id,
      modelId: provider.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      estimated: result.estimated,
      estimatedCost: 0,
      status: 'success',
      createdAt: result.finishedAt
    });
    console.log(muted(`${formatNumber(result.totalTokens)} tokens${result.estimated ? '（估算）' : ''}`));
    return result.output;
  } catch (error) {
    process.stdout.write('\n');
    if (error.name === 'AbortError') throw new Error('请求已取消。');
    throw error;
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}

async function interactiveChat(configStore, usageStore) {
  const config = configStore.publicConfig();
  if (!printProvider(config)) return;
  console.log(muted('输入 /help 查看命令，输入 /exit 退出。\n'));
  let messages = [];
  const rl = createPrompt();
  while (true) {
    const input = await ask(rl, color('1;36', '你'));
    if (!input) continue;
    if (input === '/exit' || input === '/quit') break;
    if (input === '/help') {
      console.log('/model <ID> 切换模型  /usage 查看本月用量  /clear 清空上下文  /exit 退出');
      continue;
    }
    if (input === '/clear') {
      messages = [];
      console.log(success('对话上下文已清空。'));
      continue;
    }
    if (input === '/usage') {
      printUsage(usageStore.summary('month'));
      continue;
    }
    if (input.startsWith('/model ')) {
      await setModel(configStore, input.slice(7).trim());
      continue;
    }
    messages.push({ role: 'user', content: input });
    try {
      const output = await runChatRequest({ configStore, usageStore, messages });
      messages.push({ role: 'assistant', content: output });
    } catch (error) {
      messages.pop();
      console.error(failure(error.message));
    }
  }
  rl.close();
}

async function main() {
  await app.whenReady();
  const configStore = new ConfigStore(app.getPath('userData'));
  const usageStore = new UsageStore(app.getPath('userData'));
  await Promise.all([configStore.load(), usageStore.load()]);

  const [command = 'help', ...args] = process.argv.slice(2);
  switch (command) {
    case 'login':
      await login(configStore, args);
      break;
    case 'status':
      printProvider(configStore.publicConfig());
      break;
    case 'models':
      await listModels(configStore);
      break;
    case 'model':
      await setModel(configStore, args.join(' ').trim());
      break;
    case 'chat': {
      const prompt = args.join(' ').trim();
      if (prompt) await runChatRequest({ configStore, usageStore, messages: [{ role: 'user', content: prompt }] });
      else await interactiveChat(configStore, usageStore);
      break;
    }
    case 'usage': {
      const range = args[0] || 'month';
      if (!['day', 'month', 'year', 'all'].includes(range)) throw new Error('用量范围仅支持 day、month、year 或 all。');
      printUsage(usageStore.summary(range));
      break;
    }
    case 'logout':
      await configStore.clearProvider();
      console.log(success('本地 API 配置已清除。'));
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      throw new Error(`未知命令：${command}。运行 codex-flow help 查看帮助。`);
  }
}

main()
  .catch(error => {
    console.error(failure(`错误：${error.message}`));
    process.exitCode = 1;
  })
  .finally(() => app.quit());
