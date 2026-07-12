const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VideoSkillService } = require('../electron/services/video-skill-service.cjs');

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-flow-video-skill-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'bundled-skills');
  const codexHome = path.join(root, 'codex-home');
  await fs.mkdir(path.join(sourceRoot, 'video-studio', 'agents'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'video-studio', 'SKILL.md'), '---\nname: video-studio\ndescription: video\n---\n', 'utf8');
  await fs.writeFile(path.join(sourceRoot, 'video-studio', 'agents', 'openai.yaml'), 'interface:\n  display_name: Video Studio\n', 'utf8');
  return { sourceRoot, codexHome };
}

test('video skills are copied locally and missing official plugins install automatically', async t => {
  const fixture = await createFixture(t);
  const installed = [];
  const service = new VideoSkillService({
    ...fixture,
    listExtensions: async () => ({
      plugins: [
        { id: 'remotion@openai-api-curated', installed: false, iconDataUrl: 'data:image/png;base64,AA==', brandColor: '#0B84F3' },
        { id: 'hyperframes@openai-api-curated', installed: true, iconDataUrl: 'data:image/png;base64,AQ==', brandColor: '#0a0a0a' }
      ]
    }),
    installPlugin: async id => { installed.push(id); }
  });
  await service.prepareBundledSkill();
  const status = await service.ensure();
  assert.equal(await fs.readFile(path.join(fixture.codexHome, 'skills', 'video-studio', 'SKILL.md'), 'utf8').then(value => value.includes('video-studio')), true);
  assert.deepEqual(installed, ['remotion@openai-api-curated']);
  assert.equal(status.phase, 'ready');
  assert.equal(status.bundledSkill.installed, true);
  assert.equal(status.plugins.every(plugin => plugin.installed), true);
});

test('offline bundled skill remains usable when one official plugin fails', async t => {
  const fixture = await createFixture(t);
  const service = new VideoSkillService({
    ...fixture,
    listExtensions: async () => ({ plugins: [] }),
    installPlugin: async id => {
      if (id.startsWith('hyperframes')) throw new Error('network unavailable');
    }
  });
  const status = await service.ensure();
  assert.equal(status.phase, 'partial');
  assert.equal(status.bundledSkill.installed, true);
  assert.equal(status.plugins.find(plugin => plugin.id.startsWith('remotion')).installed, true);
  assert.equal(status.plugins.find(plugin => plugin.id.startsWith('hyperframes')).status, 'failed');
});
