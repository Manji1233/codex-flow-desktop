const test = require('node:test');
const assert = require('node:assert/strict');
const { CODING_PLANS, getCodingPlan, normalizeCodingPlanModels, chooseCodingPlanModel } = require('../electron/services/coding-plans.cjs');

test('all major coding plan presets resolve their official endpoints', () => {
  assert.equal(CODING_PLANS.length, 4);
  for (const plan of CODING_PLANS) {
    assert.equal(getCodingPlan(plan.baseUrl)?.id, plan.id);
    const models = normalizeCodingPlanModels(plan, []);
    assert.equal(chooseCodingPlanModel(plan, models), plan.defaultModel);
    assert.ok(models.some(model => model.id === plan.defaultModel));
  }
});

test('volcengine coding plan removes unsupported general models', () => {
  const plan = getCodingPlan('https://ark.cn-beijing.volces.com/api/coding/v3');
  const models = normalizeCodingPlanModels(plan, [
    { id: 'deepseek-r1-250120' },
    { id: 'deepseek-v3-2-251201' },
    { id: 'doubao-seedream-5-0' }
  ]);
  assert.ok(models.some(model => model.id === 'deepseek-v3-2-251201'));
  assert.ok(!models.some(model => model.id === 'deepseek-r1-250120'));
  assert.ok(!models.some(model => model.id === 'doubao-seedream-5-0'));
});


test('latest coding plan model aliases are included', () => {
  const volcengine = getCodingPlan('https://ark.cn-beijing.volces.com/api/coding/v3');
  const volcModels = normalizeCodingPlanModels(volcengine, []);
  assert.ok(volcModels.some(model => model.id === 'doubao-seed-2.0-code'));
  assert.ok(volcModels.some(model => model.id === 'glm-5.2'));

  const zhipu = getCodingPlan('https://open.bigmodel.cn/api/coding/paas/v4');
  const zhipuModels = normalizeCodingPlanModels(zhipu, []);
  assert.equal(chooseCodingPlanModel(zhipu, zhipuModels), 'glm-5.2');
  assert.ok(zhipuModels.some(model => model.id === 'glm-5-turbo'));

  const aliyun = getCodingPlan('https://coding.dashscope.aliyuncs.com/v1');
  const aliyunModels = normalizeCodingPlanModels(aliyun, []);
  assert.ok(aliyunModels.some(model => model.id === 'qwen3-coder-next'));
  assert.ok(aliyunModels.some(model => model.id === 'MiniMax-M2.5'));
});
