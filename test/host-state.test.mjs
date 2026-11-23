import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { apply, Config, readSettings } from '../lib/index.js'

const DEFAULT_PERSONA = 'hajimi-persona'
const SESSION_PERSONA = 'xiaoke-persona'
const sessionA = 'session-test-a'
const sessionB = 'session-test-b'

const session = (id, turns, time) => ({
  id,
  header: { createdAt: time },
  snapshotEvents: () => Array.from({ length: turns }, (_, seq) => ({
    type: 'user/message',
    time: time + seq,
    data: { text: 'Synthetic input' },
  })),
})
const active = body => body.personas.activePersonas.map(persona => persona.id)
const renderPersonaPrompt = assembly => renderPrompt({
  ...assembly,
  sections: assembly.sections.filter(section => section.name === 'persona-hub'),
})

async function host(t, raw = {}, { commit = () => {}, writable = true, native = false } = {}) {
  const ctx = new Context()
  const routes = new Map()
  const panels = new Map()
  const strips = new Map()
  if (native) {
    ctx.provide('dshGo', {
      panel: (id, definition) => panels.set(id, definition),
      strip: (id, data) => strips.set(id, data),
    })
  }
  const now = Date.now()
  const sessions = new Map([
    [sessionA, session(sessionA, 1, now - 5000)],
    [sessionB, session(sessionB, 3, now - 1000)],
  ])
  const profileEntry = { options: { id: 'persona-hub' } }
  const otherEntry = { options: { id: 'persona-hub' } }
  let stored = { scanExternalDirs: false, timeFallback: 'off', ...raw }
  let resolved = Config(stored)
  // Model ConfigEditor's in-place reconciliation of volatile cells after the
  // synthetic write. A bare Cordis Fiber without DSH's Loader instead restarts.
  const live = Object.fromEntries(Object.entries(resolved).map(([key, value]) => [
    key,
    typeof value?.get === 'function' ? { get: () => resolved[key].get() } : value,
  ]))
  let queue = Promise.resolve()
  let listReads = 0
  let changes = 0

  ctx.provide('webServer', {
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  })
  ctx.provide('sessions', {
    get: id => sessions.get(id),
    list: () => {
      listReads++
      return [...sessions.values()]
    },
  })
  if (writable) {
    ctx.provide('configEditor', {
      entries: () => [otherEntry, profileEntry],
      edit(entry, change) {
        assert.equal(entry, profileEntry)
        const operation = queue.then(async () => {
          const next = change(structuredClone(stored))
          const validated = Config(next)
          await commit(next)
          resolved = validated
          stored = next
        })
        queue = operation.catch(() => {})
        return operation
      },
    })
  }

  const promptFiber = ctx.plugin(SystemPrompt)
  await promptFiber.await()
  const loaderFiber = ctx.plugin({
    inject: ['systemPrompt', 'webServer'],
    apply(owner) {
      owner.fiber.entry = profileEntry
      apply(owner, live)
    },
  })
  await loaderFiber.await()
  const off = ctx.on('system-prompt/change', () => changes++)
  t.after(async () => {
    off()
    await loaderFiber.dispose()
    await promptFiber.dispose()
  })

  async function request(path, { method = 'GET', body, text, contentType = 'application/json; charset=utf-8' } = {}) {
    const data = text ?? JSON.stringify(body) ?? ''
    const req = Object.assign(Readable.from([Buffer.from(data)]), {
      method,
      url: `/api/persona-hub/${path}`,
      headers: { 'content-type': contentType },
    })
    let result
    const res = { setHeader() {}, end: value => { result = JSON.parse(value) } }
    const handler = routes.get(new URL(req.url, 'http://localhost').pathname)
    assert.ok(handler, `${method} ${path} is registered`)
    await handler(req, res)
    return { status: res.statusCode, body: result }
  }
  const agent = id => ({ id, session: sessions.get(id) })
  async function assemble(id) {
    const scoped = id == null ? {} : { agent: agent(id) }
    if (id != null) scoped.scope = scoped.agent
    return renderPersonaPrompt(await ctx.systemPrompt.assemble(scoped))
  }
  return {
    ctx, loaderFiber, sessions, agent, assemble, request, panels, strips,
    setPersona: (sessionId, personaId) => request('session', { method: 'POST', body: { sessionId, personaId } }),
    setSettings: body => request('switch', { method: 'POST', body }),
    config: () => stored,
    changes: () => changes,
    listReads: () => listReads,
  }
}

test('native session switch updates the panel and strip while preserving the global default', async t => {
  const h = await host(t, { sessionPersonas: { [sessionA]: SESSION_PERSONA } }, { native: true })
  const scope = { sessionId: sessionA }
  const panel = h.panels.get('personas')
  const settings = h.panels.get('persona-settings')
  let card, defaults, strip, otherCard
  t.after(panel.data(scope, value => { card = value }))
  t.after(panel.data({ sessionId: sessionB }, value => { otherCard = value }))
  t.after(settings.data(scope, value => { defaults = value }))
  t.after(h.strips.get('persona')(scope, value => { strip = value }))

  assert.equal(card.activeId, SESSION_PERSONA)
  assert.equal(defaults.activeId, DEFAULT_PERSONA)
  const previousImage = card.activeLogo
  const previousStrip = strip.text
  const result = await panel.actions.switch(scope, { value: { value: 'xiaojingyu-persona' } })
  assert.deepEqual(Object.keys(result), ['patch'])
  assert.equal(result.patch.activeId, 'xiaojingyu-persona')
  assert.equal(card.activeId, result.patch.activeId)
  assert.notEqual(card.activeLogo, previousImage)
  assert.notEqual(strip.text, previousStrip)
  assert.equal(h.config().sessionPersonas[sessionA], card.activeId)
  assert.equal(h.config().activePersona ?? DEFAULT_PERSONA, DEFAULT_PERSONA)
  assert.equal(otherCard.activeId, DEFAULT_PERSONA)
  assert.deepEqual(active((await h.request(`status?sessionId=${sessionA}`)).body), [card.activeId])

  const imageMode = await panel.actions['image-mode'](scope)
  assert.match(imageMode.patch.activeLogo, /-secondary\.jpg$/)
  assert.equal(card.activeLogo, imageMode.patch.activeLogo)
  const rejected = await panel.actions.switch(scope, { value: { value: 'unknown-persona' } })
  assert.deepEqual(Object.keys(rejected), ['patch'])
  assert.match(rejected.patch.notice, /名册/)
  assert.equal(card.activeId, 'xiaojingyu-persona')

  await settings.actions['set-persona'](scope, { value: { value: SESSION_PERSONA } })
  assert.equal(defaults.activeId, SESSION_PERSONA)
  assert.equal(otherCard.activeId, SESSION_PERSONA)
  assert.equal(card.activeId, 'xiaojingyu-persona')
  await panel.actions['follow-default'](scope)
  assert.equal(Object.hasOwn(h.config().sessionPersonas, sessionA), false)
  assert.equal(card.activeId, SESSION_PERSONA)
  assert.equal(card.boundLabel, '跟随默认')
})

test('profile config supplies sidebar defaults and accepts only adaptive or whole widths in range', () => {
  const defaults = readSettings(Config({}))
  assert.equal(defaults.showSidebarCard, true)
  assert.equal(defaults.sidebarCardWidth, 0)
  for (const width of [0, 160, 279, 480]) {
    assert.equal(readSettings(Config({ sidebarCardWidth: width })).sidebarCardWidth, width)
  }
  for (const width of [-1, 1, 159, 160.5, 481, '240']) {
    assert.throws(() => Config({ sidebarCardWidth: width }))
  }
})

test('real prompt assembly selects only the scoped agent and defaults when no agent is known', async t => {
  const h = await host(t, { sessionPersonas: { [sessionA]: SESSION_PERSONA, [sessionB]: 'none' } })
  const statusA = (await h.request(`status?sessionId=${sessionA}`)).body
  assert.equal(statusA.settings.activePersona, DEFAULT_PERSONA)
  assert.equal(statusA.sessionId, sessionA)
  assert.equal(statusA.sessionAvailable, true)
  assert.equal(statusA.sessionPersona, SESSION_PERSONA)
  assert.equal(statusA.usage.convUserTurns, 1)
  assert.deepEqual(active(statusA), [SESSION_PERSONA])
  const targetEvents = t.mock.method(h.sessions.get(sessionA), 'snapshotEvents')
  const otherEvents = t.mock.method(h.sessions.get(sessionB), 'snapshotEvents')
  assert.equal(await h.assemble(sessionA), statusA.promptPreview)
  assert.equal(targetEvents.mock.callCount(), 0)
  assert.equal(otherEvents.mock.callCount(), 0)
  assert.match(statusA.promptPreview, new RegExp(SESSION_PERSONA))
  assert.doesNotMatch(statusA.promptPreview, new RegExp(DEFAULT_PERSONA))
  assert.equal(await h.assemble(sessionB), '')

  const statusDefault = (await h.request('status')).body
  assert.equal(statusDefault.sessionId, null)
  assert.equal(statusDefault.sessionPersona, null)
  assert.equal(statusDefault.sessionAvailable, false)
  assert.equal(await h.assemble(), statusDefault.promptPreview)
  assert.deepEqual(active(statusDefault), [DEFAULT_PERSONA])
  const unrecognized = await h.ctx.systemPrompt.assemble({ scope: { id: sessionA } })
  assert.equal(renderPersonaPrompt(unrecognized), statusDefault.promptPreview)
  const mismatched = await h.ctx.systemPrompt.assemble({ agent: h.agent(sessionA), scope: h.agent(sessionB) })
  assert.equal(renderPersonaPrompt(mismatched), statusDefault.promptPreview)

  const missing = (await h.request('status?sessionId=unknown-test-session')).body
  assert.equal(missing.sessionAvailable, false)
  assert.equal(missing.usage.convId, null)
  assert.equal(missing.usage.convUserTurns, 0)
  assert.equal(missing.promptPreview, statusDefault.promptPreview)

  await h.loaderFiber.dispose()
  assert.equal(await h.assemble(sessionA), '')
})

test('summary avoids telemetry lookups while reporting a stopped session and its saved selection', async t => {
  const h = await host(t, { sessionPersonas: { [sessionA]: SESSION_PERSONA } })
  h.sessions.delete(sessionA)
  const response = (await h.request(`status?view=summary&sessionId=${sessionA}`)).body
  assert.equal(response.sessionId, sessionA)
  assert.equal(response.sessionAvailable, false)
  assert.equal(response.sessionPersona, SESSION_PERSONA)
  assert.deepEqual(active(response), [SESSION_PERSONA])
  assert.equal(h.listReads(), 0)
  assert.ok(!Object.hasOwn(response, 'usage'))
  assert.ok(!Object.hasOwn(response, 'promptPreview'))
})

test('serialized writes persist exact session bindings and profile settings, and null clears only one override', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'persona-hub-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'profile.json')
  const h = await host(t, {}, { commit: next => writeFile(path, JSON.stringify(next)) })
  const [first, second, profile] = await Promise.all([
    h.setPersona(sessionA, SESSION_PERSONA),
    h.setPersona(sessionB, 'none'),
    h.setSettings({ enabled: false, showSidebarCard: false, sidebarCardWidth: 280, sessionId: sessionA, personaId: 'none' }),
  ])
  assert.equal(first.status, 200)
  assert.equal(first.body.sessionPersona, SESSION_PERSONA)
  assert.deepEqual(active(first.body), [SESSION_PERSONA])
  assert.equal(second.status, 200)
  assert.equal(second.body.sessionPersona, 'none')
  assert.equal(profile.status, 200)
  assert.equal(profile.body.sessionId, null)
  assert.equal(profile.body.sessionPersona, null)
  assert.equal(profile.body.sessionAvailable, false)
  assert.equal(profile.body.settings.showSidebarCard, false)
  assert.equal(profile.body.settings.sidebarCardWidth, 280)
  assert.equal(profile.body.promptPreview, '')
  assert.equal(h.changes(), 3)
  assert.match(await h.assemble(sessionA), new RegExp(SESSION_PERSONA))
  assert.equal(await h.assemble(sessionB), '')

  const persisted = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(persisted.sessionPersonas, { [sessionA]: SESSION_PERSONA, [sessionB]: 'none' })
  assert.equal(persisted.sidebarCardWidth, 280)
  const restored = await host(t, persisted)
  assert.match(await restored.assemble(sessionA), new RegExp(SESSION_PERSONA))
  assert.equal(await restored.assemble(), '')
  assert.equal((await restored.setSettings({ enabled: true })).status, 200)
  const cleared = await restored.setPersona(sessionA, null)
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.sessionPersona, null)
  assert.deepEqual(active(cleared.body), [DEFAULT_PERSONA])
  assert.deepEqual(restored.config().sessionPersonas, { [sessionB]: 'none' })
  assert.equal(await restored.assemble(sessionB), '')
})

test('unavailable explicit persona stays inactive until the binding is cleared', async t => {
  const h = await host(t, { sessionPersonas: { [sessionA]: 'missing-persona' } })
  const response = (await h.request(`status?sessionId=${sessionA}`)).body
  assert.equal(response.sessionPersona, 'missing-persona')
  assert.equal(response.promptPreview, '')
  assert.deepEqual(active(response), [])
  assert.equal(await h.assemble(sessionA), '')
  await h.setPersona(sessionA, null)
  assert.match(await h.assemble(sessionA), new RegExp(DEFAULT_PERSONA))
})

test('invalid input and missing sessions cannot write or change the prompt', async t => {
  let writes = 0
  const h = await host(t, {}, { commit: () => { writes++ } })
  for (const id of ['', '/bad', '__proto__', 'constructor', ' session-test-a', undefined]) {
    assert.equal((await h.setPersona(id, SESSION_PERSONA)).status, 400)
  }
  assert.equal((await h.setPersona('unknown-test-session', SESSION_PERSONA)).status, 404)
  for (const personaId of ['', [], 'missing-persona', `${DEFAULT_PERSONA},${SESSION_PERSONA}`, undefined]) {
    assert.equal((await h.setPersona(sessionA, personaId)).status, 400)
  }
  for (const width of [159, 481, 220.5, '240', null]) {
    assert.equal((await h.setSettings({ sidebarCardWidth: width, enabled: false })).status, 400)
  }
  assert.equal((await h.setSettings({ showSidebarCard: 'false' })).status, 400)
  for (const route of ['session', 'switch']) {
    assert.equal((await h.request(route, { method: 'POST', contentType: 'text/plain', body: {} })).status, 415)
    assert.equal((await h.request(route, { method: 'POST', text: 'null' })).status, 400)
  }
  assert.equal(writes, 0)
  assert.equal(h.changes(), 0)
  assert.match(await h.assemble(sessionA), new RegExp(DEFAULT_PERSONA))
})

test('an uncommitted or rejected write is never reported or used as a binding', async t => {
  let rejectCommit
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const h = await host(t, {}, {
    commit: () => new Promise((resolve, reject) => {
      rejectCommit = reject
      markStarted()
    }),
  })
  let settled = false
  const pending = h.setPersona(sessionA, SESSION_PERSONA).then(response => {
    settled = true
    return response
  })
  await started
  assert.equal(settled, false)
  assert.match(await h.assemble(sessionA), new RegExp(DEFAULT_PERSONA))
  rejectCommit(new Error('simulated write failure'))
  assert.equal((await pending).status, 500)
  assert.equal(h.changes(), 0)
  assert.match(await h.assemble(sessionA), new RegExp(DEFAULT_PERSONA))

  const readOnly = await host(t, {}, { writable: false })
  assert.equal((await readOnly.request(`status?sessionId=${sessionA}`)).body.sessionAvailable, false)
  assert.equal((await readOnly.setPersona(sessionA, SESSION_PERSONA)).status, 503)
  assert.equal((await readOnly.setSettings({ showSidebarCard: false })).status, 503)
})
