import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import { discoverPersonas, renderPersonaSystemPrompt, type PersonaHubSettings } from './personas.ts'
import { getDshUsageTelemetry } from './telemetry.ts'
import type { TimeInjector } from './time.ts'

interface LiveSession {
  readonly id: string
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)
    && value !== 'constructor' && value !== 'prototype'
}

function lookupSession(ctx: Context, id: string): LiveSession | undefined {
  // The Host SessionStore returns the exact live local Session, not archived logs or remote rows.
  const sessions = ctx.get('sessions') as { get(id: string): LiveSession | undefined } | undefined
  const session = sessions?.get(id)
  return session?.id === id ? session : undefined
}

function sessionForPrompt(assembly: AssembleContext): LiveSession | undefined {
  // dsh-agent's assembleContextFor(agent) passes { agent, scope: agent }.
  // Generic preset/registry assemblies can also have a non-agent scope.
  const scope = assembly.scope as { id?: string; session?: LiveSession } | undefined
  const { agent } = assembly as AssembleContext & { agent?: object }
  const session = scope?.session
  return (agent === undefined || agent === scope) && isSessionId(scope?.id) && session?.id === scope.id
    ? session
    : undefined
}

type RawConfig = Record<string, unknown>
type ConfigChange = (current: RawConfig) => RawConfig
interface ConfigEditor {
  entries(): readonly object[]
  edit(entry: object, change: ConfigChange): Promise<void>
}

function profileEditor(ctx: Context) {
  // Use the exact Loader entry that owns this fiber (see installed dsh-doc configuration.md).
  const entry = ctx.fiber.entry
  const editor = ctx.get('configEditor') as ConfigEditor | undefined
  return entry && editor?.entries().includes(entry) ? { entry, editor } : undefined
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function editProfileConfig(ctx: Context, change: ConfigChange): Promise<void> {
  const target = profileEditor(ctx)
  if (!target) throw new RequestError(503, 'Persona Hub configuration is not writable in this profile')
  try {
    // The editor serializes changes and only resolves once it has persisted and reconciled them.
    await target.editor.edit(target.entry, change)
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError(500, 'Could not save Persona Hub configuration')
  }
}

function notifyPromptChange(ctx: Context): void {
  // DSH rebuilds the section on its next proposed model step. This unscoped emit
  // also notifies registry observers; an observer failure cannot undo the saved choice.
  try {
    ctx.emit('system-prompt/change')
  } catch {
    // Already committed.
  }
}

const MAX_BODY = 64 * 1024

async function readJson(req: IncomingMessage): Promise<RawConfig> {
  const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase()
  // Reject browser simple requests. Same-origin clients and CLI callers already send JSON.
  if (contentType !== 'application/json') throw new RequestError(415, 'Expected application/json')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY) throw new RequestError(413, 'Payload too large')
    chunks.push(buffer)
  }
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new RequestError(400, 'Invalid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'Expected a JSON object')
  }
  return body as RawConfig
}

export function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function profileSettingsPatch(body: RawConfig): Partial<PersonaHubSettings> {
  const patch: Partial<PersonaHubSettings> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.activePersona === 'string') patch.activePersona = body.activePersona.trim() || 'none'
  if (body.preferredImageMode === 'realistic' || body.preferredImageMode === 'secondary') {
    patch.preferredImageMode = body.preferredImageMode
  }
  if (typeof body.scanExternalDirs === 'boolean') patch.scanExternalDirs = body.scanExternalDirs
  if (typeof body.externalPluginsDir === 'string') patch.externalPluginsDir = body.externalPluginsDir.trim()
  if (body.timeFallback === 'auto' || body.timeFallback === 'always' || body.timeFallback === 'off') {
    patch.timeFallback = body.timeFallback
  }
  if (typeof body.timeZone === 'string') patch.timeZone = body.timeZone.trim()
  if (body.showSidebarCard !== undefined) {
    if (typeof body.showSidebarCard !== 'boolean') throw new RequestError(400, 'Invalid showSidebarCard')
    patch.showSidebarCard = body.showSidebarCard
  }
  if (body.sidebarCardWidth !== undefined) {
    const width = body.sidebarCardWidth
    if (typeof width !== 'number' || !Number.isInteger(width) || (width !== 0 && (width < 160 || width > 480))) {
      throw new RequestError(400, 'sidebarCardWidth must be 0 (adaptive) or an integer from 160 to 480')
    }
    patch.sidebarCardWidth = width
  }
  return patch
}

interface HostStateOptions {
  readSettings(): PersonaHubSettings
  readBindings(): Readonly<Record<string, string>>
  sectionOrder: number
  timeInjector: TimeInjector
}

export function registerPersonaState(ctx: Context, options: HostStateOptions) {
  const { readSettings, readBindings, sectionOrder, timeInjector } = options

  function personaFor(sessionId: string | null): string | null {
    if (sessionId === null) return null
    const bindings = readBindings()
    return Object.hasOwn(bindings, sessionId) ? bindings[sessionId] : null
  }

  function status(sessionId: string | null, summary = false) {
    const settings = readSettings()
    const now = new Date()
    const sessionPersona = personaFor(sessionId)
    const personas = discoverPersonas(settings, now, sessionPersona)
    const payload = {
      ok: true,
      timestamp: now.toISOString(),
      settings,
      personas,
      sessionId,
      sessionPersona,
      sessionAvailable: sessionId !== null && !!lookupSession(ctx, sessionId) && !!profileEditor(ctx),
    }
    if (summary) return payload

    const usage = getDshUsageTelemetry(ctx, sessionId, now.getTime())
    void timeInjector.refresh()
    return {
      ...payload,
      usage,
      promptPreview: renderPersonaSystemPrompt(personas),
      time: timeInjector.report(settings, now),
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/persona-hub/status',
    handler: (req, res) => {
      if (req.method !== 'GET') return replyJson(res, 405, { ok: false, error: 'method not allowed' })
      const { searchParams } = new URL(req.url || '/', 'http://127.0.0.1')
      const sessionId = (searchParams.get('sessionId') ?? searchParams.get('conversationId')) || null
      if (sessionId !== null && !isSessionId(sessionId)) {
        return replyJson(res, 400, { ok: false, error: 'Invalid sessionId' })
      }
      return replyJson(res, 200, status(sessionId, searchParams.get('view') === 'summary'))
    },
  }))

  function registerMutation(path: string, mutate: (body: RawConfig) => Promise<string | null>): void {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (req.method !== 'POST') return replyJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const sessionId = await mutate(await readJson(req))
          return replyJson(res, 200, status(sessionId))
        } catch (error) {
          if (error instanceof RequestError) return replyJson(res, error.status, { ok: false, error: error.message })
          return replyJson(res, 500, { ok: false, error: 'Could not complete Persona Hub request' })
        }
      },
    }))
  }

  registerMutation('/api/persona-hub/switch', async body => {
    const patch = profileSettingsPatch(body)
    if (Object.keys(patch).length > 0) {
      await editProfileConfig(ctx, current => ({ ...current, ...patch }))
      notifyPromptChange(ctx)
    }
    return null
  })

  async function setSessionPersona(sessionId: unknown, personaId: unknown) {
    if (!isSessionId(sessionId)) throw new RequestError(400, 'Invalid sessionId')
    if (personaId !== null && (typeof personaId !== 'string' || personaId.length === 0)) {
      throw new RequestError(400, 'Invalid personaId')
    }
    const session = lookupSession(ctx, sessionId)
    if (!session) throw new RequestError(404, 'Session is not live on this host')

    await editProfileConfig(ctx, current => {
      // Recheck when the serialized edit actually runs, after any earlier profile edits.
      if (lookupSession(ctx, sessionId) !== session) throw new RequestError(404, 'Session is not live on this host')
      if (personaId !== null && personaId !== 'none'
        && !discoverPersonas(readSettings()).allPersonas.some(persona => persona.id === personaId)) {
        throw new RequestError(400, 'Unknown personaId')
      }
      const sessionPersonas = { ...(current.sessionPersonas as Record<string, string> | undefined) }
      if (personaId === null) delete sessionPersonas[sessionId]
      else sessionPersonas[sessionId] = personaId
      return { ...current, sessionPersonas }
    })
    notifyPromptChange(ctx)
    return sessionId
  }

  registerMutation('/api/persona-hub/session', ({ sessionId, personaId }) => setSessionPersona(sessionId, personaId))

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'persona-hub',
    order: sectionOrder,
    interpolate: false,
    text: (assembly: AssembleContext) => {
      const session = sessionForPrompt(assembly)
      const now = new Date()
      const personas = discoverPersonas(readSettings(), now, personaFor(session?.id ?? null))
      if (personas.activeCount === 0) return ''
      return renderPersonaSystemPrompt(personas)
    },
  }))

  return { personaFor, setSessionPersona }
}
