const CODING_PLANS = [
  {
    id: 'volcengine-coding-plan',
    name: '火山方舟 Coding Plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    defaultModel: 'ark-code-latest',
    fallbackModels: [
      'ark-code-latest',
      'doubao-seed-2.0-code',
      'doubao-seed-2.0-pro',
      'doubao-seed-2.0-lite',
      'glm-5.2',
      'kimi-k2.7',
      'minimax-m3',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v3.2',
      'glm-4.7',
      'doubao-seed-code'
    ],
    strictPatterns: [
      /^ark-code-latest$/,
      /^doubao-seed-2(?:[.-])0-(?:code|pro|lite)/,
      /^doubao-seed-2-0-(?:code|pro|lite)-/,
      /^doubao-seed-code/,
      /^glm-5(?:[.-])2/,
      /^glm-5-2-/,
      /^glm-4(?:[.-])7/,
      /^glm-4-7-/,
      /^kimi-k2(?:[.-])7/,
      /^kimi-k2-7-/,
      /^kimi-k2-5-/,
      /^minimax-m3/,
      /^deepseek-v4/,
      /^deepseek-v3(?:[.-])2/,
      /^deepseek-v3-2-/
    ]
  },
  {
    id: 'aliyun-coding-plan',
    name: '阿里云百炼 Coding Plan',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3.7-plus',
    fallbackModels: [
      'qwen3.7-plus',
      'qwen3.6-plus',
      'kimi-k2.5',
      'glm-5',
      'MiniMax-M2.5',
      'qwen3.5-plus',
      'qwen3-max-2026-01-23',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'glm-4.7'
    ]
  },
  {
    id: 'zhipu-coding-plan',
    name: '智谱 GLM Coding Plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultModel: 'glm-5.2',
    fallbackModels: ['glm-5.2', 'glm-5.2[1m]', 'glm-5-turbo', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.5-air']
  },
  {
    id: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/coding/v3',
    defaultModel: 'tc-code-latest',
    fallbackModels: ['tc-code-latest', 'glm-5', 'glm-4.7', 'kimi-k2.5', 'minimax-m2.5', 'minimax-m2.1', 'qwen3-coder-plus', 'qwen3.5-plus', 'qwen3-max']
  }
];

function normalizeUrl(value = '') {
  return String(value).replace(/\/+$/, '').toLowerCase();
}

function getCodingPlan(baseUrl = '') {
  const normalized = normalizeUrl(baseUrl);
  return CODING_PLANS.find(plan => normalized === normalizeUrl(plan.baseUrl)) || null;
}

function normalizeCodingPlanModels(plan, discovered = []) {
  let models = discovered.filter(model => model?.id);
  if (plan.strictPatterns) models = models.filter(model => plan.strictPatterns.some(pattern => pattern.test(model.id)));
  const merged = new Map();
  for (const modelId of plan.fallbackModels) merged.set(modelId, { id: modelId, ownedBy: plan.id });
  for (const model of models) merged.set(model.id, model);
  return [...merged.values()];
}

function chooseCodingPlanModel(plan, models, requestedModel) {
  if (requestedModel && models.some(model => model.id === requestedModel)) return requestedModel;
  if (models.some(model => model.id === plan.defaultModel)) return plan.defaultModel;
  return models[0]?.id || plan.defaultModel;
}

module.exports = { CODING_PLANS, getCodingPlan, normalizeCodingPlanModels, chooseCodingPlanModel };
