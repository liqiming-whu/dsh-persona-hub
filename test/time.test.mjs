import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTimeInjector,
  formatFallbackTimeBlock,
  formatUtcOffset,
  resolveTimeZone,
} from '../lib/index.js'

const NOW = new Date('2026-11-18T15:53:20+08:00')

function fakeCtx(origin = 'http://127.0.0.1:9999') {
  return { webServer: { getOrigin: () => origin } }
}

function stubFetch(payload, status = 200) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (payload === undefined) throw new SyntaxError('Unexpected token <')
      return payload
    },
  })
}

const settings = { timeFallback: 'auto', timeZone: 'Asia/Shanghai' }

test('formatFallbackTimeBlock renders a zh-CN reality-time block', () => {
  const block = formatFallbackTimeBlock(NOW, { timeZone: 'Asia/Shanghai', locale: 'zh-CN' })
  assert.ok(block.startsWith('【现实环境信息】'))
  assert.ok(block.includes('当前时间：2026年11月18日 15:53:20'), block)
  assert.ok(block.includes('时区：Asia/Shanghai (UTC+08:00)'), block)
  assert.ok(block.includes('星期：星期三'), block)
  assert.equal(block.split('\n').length, 4)
})

test('formatFallbackTimeBlock renders an en-US reality-time block', () => {
  const block = formatFallbackTimeBlock(NOW, { timeZone: 'Asia/Shanghai', locale: 'en-US' })
  assert.ok(block.startsWith('[Current environment]'))
  assert.ok(block.includes('Local time: 2026-11-18 15:53:20'), block)
  assert.ok(block.includes('Time zone: Asia/Shanghai (UTC+08:00)'), block)
  assert.ok(block.includes('Weekday: Wednesday'), block)
})

test('formatUtcOffset and resolveTimeZone normalise the zone', () => {
  assert.equal(formatUtcOffset(NOW, 'Asia/Shanghai'), 'UTC+08:00')
  assert.equal(formatUtcOffset(NOW, 'UTC'), 'UTC+00:00')
  assert.equal(resolveTimeZone('Asia/Shanghai'), 'Asia/Shanghai')
  // An invalid configured zone must never leak into the prompt.
  assert.notEqual(resolveTimeZone('Not/AZone'), 'Not/AZone')
  assert.ok(resolveTimeZone(''))
})

test('auto mode stays silent while environment-context already injects time', async () => {
  stubFetch({ ok: true, prompt: '【现实环境信息】\n当前时间：2026年11月18日' })
  const injector = createTimeInjector(fakeCtx(), { autoStart: false })
  await injector.refresh(true)

  const state = injector.state()
  assert.equal(state.environmentContext, 'active')
  assert.equal(state.providesTime, true)

  assert.equal(injector.compose(settings, NOW), '')
  const report = injector.report(settings, NOW)
  assert.equal(report.injected, false)
  assert.equal(report.source, 'environment-context')
  injector.dispose()
})

test('auto mode takes over when environment-context is online but time-less', async () => {
  stubFetch({ ok: true, prompt: '' })
  const injector = createTimeInjector(fakeCtx(), { autoStart: false })
  await injector.refresh(true)

  assert.equal(injector.state().environmentContext, 'active')
  assert.equal(injector.state().providesTime, false)
  const block = injector.compose(settings, NOW)
  assert.ok(block.includes('当前时间：2026年11月18日 15:53:20'))
  assert.equal(injector.report(settings, NOW).source, 'persona-hub')
  injector.dispose()
})

test('auto mode takes over when dsh-environment-context is absent', async () => {
  stubFetch(undefined, 404)
  const injector = createTimeInjector(fakeCtx(), { autoStart: false })
  await injector.refresh(true)

  assert.equal(injector.state().environmentContext, 'absent')
  const block = injector.compose(settings, NOW)
  assert.ok(block.includes('星期：星期三'))
  assert.equal(injector.report(settings, NOW).injected, true)
  injector.dispose()
})

test('an unreachable probe degrades to injecting time rather than dropping it', async () => {
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  const injector = createTimeInjector(fakeCtx(), { autoStart: false })
  await injector.refresh(true)

  assert.equal(injector.state().environmentContext, 'unknown')
  assert.ok(injector.compose(settings, NOW).includes('当前时间'))
  injector.dispose()
})

test('explicit always / off modes override the probe result', async () => {
  stubFetch({ ok: true, prompt: '【现实环境信息】\n当前时间：2026年11月18日' })
  const injector = createTimeInjector(fakeCtx(), { autoStart: false })
  await injector.refresh(true)

  const forced = injector.compose({ ...settings, timeFallback: 'always' }, NOW)
  assert.ok(forced.includes('当前时间'))
  assert.equal(injector.compose({ ...settings, timeFallback: 'off' }, NOW), '')
  assert.equal(injector.report({ ...settings, timeFallback: 'off' }, NOW).source, 'none')
  injector.dispose()
})
