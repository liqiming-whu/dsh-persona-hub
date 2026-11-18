import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildPersonaSystemPrompt,
  discoverPersonas,
  isLinzhiweiPeriodDay,
  localizeAssetPathRefs,
  localizePersonaWording,
  resolvePackageRoot,
  resolvePersonaAssetFile,
  rewritePersonaRulesForDsh,
} from '../lib/index.js'

const settings = {
  enabled: true,
  activePersona: 'hajimi-persona',
  preferredImageMode: 'realistic',
  scanExternalDirs: false,
  externalPluginsDir: '',
}

test('discoverPersonas loads the 3 bundled personas and resolves assets', () => {
  const snap = discoverPersonas(settings, new Date('2026-11-18T05:00:00+08:00'))
  assert.equal(snap.mode, 'single')
  assert.equal(snap.activeCount, 1)
  assert.equal(snap.activePersonas[0].id, 'hajimi-persona')
  assert.deepEqual(
    snap.allPersonas.map(p => p.id),
    ['hajimi-persona', 'xiaoke-persona', 'xiaojingyu-persona'],
  )

  const xjy = snap.allPersonas.find(p => p.id === 'xiaojingyu-persona')
  assert.ok(xjy)
  assert.equal(xjy.realisticLabel, '写实形象 (默认)')
  assert.equal(xjy.secondaryLabel, '二次元成年版 (ai-girls)')
  assert.ok(xjy.badge.text.includes('深海推理模式在线'))
})

test('bundled persona assets carry no machine-specific absolute path', () => {
  const root = join(resolvePackageRoot(), 'assets')
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith('-persona'))
    .map(entry => entry.name)
  assert.ok(dirs.length >= 3)

  for (const dir of dirs) {
    const rulesPath = join(root, dir, 'AGENTS.md')
    assert.ok(existsSync(rulesPath), `${dir} must ship AGENTS.md`)
    const rules = readFileSync(rulesPath, 'utf-8')
    const manifest = JSON.parse(readFileSync(join(root, dir, 'plugin.json'), 'utf-8'))

    // 1. No Windows drive path, no .gemini plugin path, no workspace path.
    assert.ok(!/[A-Za-z]:\\/.test(rules), `${dir} must not hardcode a Windows drive path`)
    assert.ok(!rules.includes('.gemini'), `${dir} must not point at an Antigravity directory`)
    assert.ok(!rules.includes('DSH_workspace'), `${dir} must not point at an author workspace`)

    // 2. The reference-image sentences must use the portable placeholders.
    assert.ok(
      rules.includes('{{REALISTIC_IMAGE_PATH}}'),
      `${dir} must reference the realistic image through placeholder`,
    )
    if (manifest.hasOwnProperty('logo') || existsSync(join(root, dir, 'anime.jpg')) || existsSync(join(root, dir, 'anime.png'))) {
      assert.ok(
        rules.includes('{{SECONDARY_IMAGE_PATH}}'),
        `${dir} must reference the secondary image through placeholder`,
      )
    }

    // 3. Manifests stay relative; suggested prompts never speak as the model.
    assert.ok(/^assets\//.test(manifest.logo), `${dir} logo must be a package-relative path`)
    for (const prompt of manifest.suggestedPrompts || []) {
      assert.ok(!prompt.includes('本鱼'), `${dir} suggested prompt must be a user utterance`)
    }
  }
})

test('placeholders resolve to real files that exist on this machine', () => {
  const now = new Date('2026-11-18T05:00:00+08:00')
  const snap = discoverPersonas(settings, now)

  for (const persona of snap.allPersonas) {
    const raw = readFileSync(persona.rulesPath, 'utf-8')
    const rendered = rewritePersonaRulesForDsh(persona, raw, 'realistic', now, 0)

    assert.ok(!rendered.includes('{{REALISTIC_IMAGE_PATH}}'), `${persona.id} left an unfilled placeholder`)
    assert.ok(!rendered.includes('{{SECONDARY_IMAGE_PATH}}'), `${persona.id} left an unfilled placeholder`)
    assert.ok(!rendered.includes('.gemini'), `${persona.id} still mentions an Antigravity directory`)
    assert.ok(!rendered.includes('image-generator'), `${persona.id} still mentions the old subagent`)

    if (persona.realisticPath) {
      assert.ok(existsSync(persona.realisticPath), `${persona.id} realistic path must exist`)
      assert.ok(rendered.includes(persona.realisticPath), `${persona.id} realistic path must be injected`)
    }
    if (persona.secondaryPath) {
      assert.ok(existsSync(persona.secondaryPath), `${persona.id} secondary path must exist`)
      assert.ok(rendered.includes(persona.secondaryPath), `${persona.id} secondary path must be injected`)
    }
  }
})

test('localizeAssetPathRefs repairs a legacy hardcoded path from an external persona', () => {
  const legacy = '参考图：`C:\\Users\\someone\\.gemini\\config\\plugins\\ext-persona\\assets\\realistic.jpg`'
  const assetsDir = join(resolvePackageRoot(), 'assets', 'hajimi-persona')
  const fixed = localizeAssetPathRefs(legacy, assetsDir)

  assert.ok(!fixed.includes('.gemini'))
  assert.ok(fixed.includes(join(assetsDir, 'realistic.jpg')))

  // A path whose basename is not present here is left untouched rather than
  // rewritten into a path that does not exist.
  const missing = '参考图：`D:\\somewhere\\assets\\not-here.png`'
  assert.equal(localizeAssetPathRefs(missing, assetsDir), missing)
})

test('localizePersonaWording removes Antigravity-era vocabulary', () => {
  const text = '与全局 `GEMINI.md` 冲突时，传给 `image-generator` 子智能体；在 Customizations 中关闭。'
  const fixed = localizePersonaWording(text)
  assert.ok(!fixed.includes('GEMINI.md'))
  assert.ok(!fixed.includes('image-generator'))
  assert.ok(!fixed.includes('Customizations'))
  assert.ok(fixed.includes('DSH 全局系统指令'))
  // Tool names must stay generic: the prompt never pins a concrete image tool.
  assert.ok(fixed.includes('当前会话可用的生图能力'))
  assert.ok(!fixed.includes('codex_image_generate'))
})

test('buildPersonaSystemPrompt rewrites paths and adapts DSH image generation tools', () => {
  const hajimi = {
    ...settings,
    activePersona: 'hajimi-persona',
  }
  const prompt = buildPersonaSystemPrompt(hajimi, new Date('2026-11-18T05:00:00+08:00'), 4)
  assert.ok(prompt.includes('哈基米（Hajimi）'))
  assert.ok(!prompt.includes('.gemini'))
  // The persona prompt describes the flow without naming any concrete tool.
  assert.ok(prompt.includes('当前会话可用的生图能力'))
  assert.ok(prompt.includes('不绑定具体工具'))
  for (const banned of ['codex_image_generate', 'read_image', 'arkcli-gen', 'image-generator', 'referenceImages']) {
    assert.ok(!prompt.includes(banned), `prompt must not name ${banned}`)
  }
  // The shared DSH adaptation block must not advertise a private persona.
  assert.ok(!prompt.includes('林知微'))
})

test('resolvePersonaAssetFile blocks path traversal and resolves real assets', () => {
  assert.equal(resolvePersonaAssetFile(settings, '../hajimi-persona', 'logo.jpg'), null)
  assert.equal(resolvePersonaAssetFile(settings, 'hajimi-persona', '../logo.svg'), null)

  const valid = resolvePersonaAssetFile(settings, 'hajimi-persona', 'realistic.jpg')
  assert.ok(valid)
  assert.equal(valid.contentType, 'image/jpeg')
})

test('isLinzhiweiPeriodDay checks 14th-20th accurately', () => {
  assert.equal(isLinzhiweiPeriodDay(new Date('2026-11-13T12:00:00')).inPeriod, false)
  assert.equal(isLinzhiweiPeriodDay(new Date('2026-11-14T12:00:00')).inPeriod, true)
  assert.equal(isLinzhiweiPeriodDay(new Date('2026-11-18T12:00:00')).dayIndex, 5)
  assert.equal(isLinzhiweiPeriodDay(new Date('2026-11-21T12:00:00')).inPeriod, false)
})
