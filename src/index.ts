import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-host-webserver'
import '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import {
  buildPersonaSystemPrompt,
  computePersonaStatusBadge,
  discoverPersonas,
  isLinzhiweiPeriodDay,
  localizeAssetPathRefs,
  localizePersonaWording,
  resolvePackageRoot,
  resolvePersonaAssetFile,
  rewritePersonaRulesForDsh,
  type ImageMode,
  type PersonaBadge,
  type PersonaHubSettings,
  type PersonaItem,
  type PersonasSnapshot,
  type TimeFallbackMode,
} from './personas.ts'
import { getDshUsageTelemetry, inspectSessionEvents, type UsageTelemetry } from './telemetry.ts'
import {
  createTimeInjector,
  formatFallbackTimeBlock,
  formatUtcOffset,
  resolveTimeZone,
  type EnvironmentContextState,
  type TimeInjectionReport,
  type TimeInjector,
  type TimeProbeState,
} from './time.ts'

export {
  buildPersonaSystemPrompt,
  computePersonaStatusBadge,
  createTimeInjector,
  discoverPersonas,
  formatFallbackTimeBlock,
  formatUtcOffset,
  getDshUsageTelemetry,
  inspectSessionEvents,
  isLinzhiweiPeriodDay,
  localizeAssetPathRefs,
  localizePersonaWording,
  resolvePackageRoot,
  resolvePersonaAssetFile,
  resolveTimeZone,
  rewritePersonaRulesForDsh,
}
export type {
  EnvironmentContextState,
  ImageMode,
  PersonaBadge,
  PersonaHubSettings,
  PersonaItem,
  PersonasSnapshot,
  TimeFallbackMode,
  TimeInjectionReport,
  TimeInjector,
  TimeProbeState,
  UsageTelemetry,
}

export const name = 'persona-hub'
export const inject = ['systemPrompt', 'webServer', 'skills']
export const SETTINGS_NAMESPACE = 'persona-hub'

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  activePersona: z.string().default('hajimi-persona').volatile(),
  preferredImageMode: z.union(['realistic', 'secondary']).default('realistic').volatile(),
  scanExternalDirs: z.boolean().default(true).volatile(),
  externalPluginsDir: z.string().default('').volatile(),
  // Time grounding is self-sufficient: `dsh-environment-context` is optional.
  timeFallback: z.union(['auto', 'always', 'off']).default('auto').volatile(),
  timeZone: z.string().default('').volatile(),
  timeSectionOrder: z.number().default(19),
  sectionOrder: z.number().default(85),
})

export type Config = ReturnType<typeof Config>

export function readSettings(
  entry: Config,
  overrides: Partial<PersonaHubSettings> = {},
): PersonaHubSettings {
  return {
    enabled: overrides.enabled ?? entry.enabled.get(),
    activePersona: overrides.activePersona ?? entry.activePersona.get(),
    preferredImageMode: (overrides.preferredImageMode ?? entry.preferredImageMode.get()) as ImageMode,
    scanExternalDirs: overrides.scanExternalDirs ?? entry.scanExternalDirs.get(),
    externalPluginsDir: overrides.externalPluginsDir ?? entry.externalPluginsDir.get(),
    timeFallback: (overrides.timeFallback ?? entry.timeFallback.get()) as TimeFallbackMode,
    timeZone: overrides.timeZone ?? entry.timeZone.get(),
  }
}

const MAX_BODY = 64 * 1024

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  let text = ''
  for await (const chunk of req) {
    text += chunk.toString()
    if (text.length > MAX_BODY) throw new Error('payload too large')
  }
  return JSON.parse(text || '{}')
}

function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function persistSettingsToConfigEditor(
  ctx: Context,
  patch: Partial<PersonaHubSettings>,
): Promise<boolean> {
  try {
    const anyCtx = ctx as any
    const configEditor = typeof anyCtx.get === 'function'
      ? anyCtx.get('configEditor')
      : anyCtx.configEditor
    if (!configEditor || typeof configEditor.entries !== 'function') return false
    const entries: any[] = configEditor.entries()
    const targetEntry = entries.find(
      e => e?.id === 'persona-hub' || e?.options?.id === 'persona-hub' || e?.options?.name === 'dsh-persona-hub',
    )
    if (!targetEntry || typeof configEditor.edit !== 'function') return false
    await configEditor.edit(targetEntry, (current: Record<string, unknown>) => ({
      ...current,
      ...patch,
    }))
    return true
  } catch {
    return false
  }
}

export function apply(ctx: Context, entry: Config): void {
  const runtimeOverrides: Partial<PersonaHubSettings> = {}
  let lastEntrySnapshot = {
    enabled: entry.enabled.get(),
    activePersona: entry.activePersona.get(),
    preferredImageMode: entry.preferredImageMode.get(),
    scanExternalDirs: entry.scanExternalDirs.get(),
    externalPluginsDir: entry.externalPluginsDir.get(),
    timeFallback: entry.timeFallback.get(),
    timeZone: entry.timeZone.get(),
  }

  const SKILL_NAME = 'persona-assistant'
  const SKILL_DESCRIPTION = '人设管理助手：指导创建、导入（本地目录 / GitHub 仓库）、移植与适配 DSH 人设插件，并说明人设控制台的面板、切换与删除操作。'

  /** Read the bundled SKILL.md once; a missing file must never break plugin apply. */
  function readBundledSkill(): { path: string; raw: string } | null {
    try {
      const moduleDirectory = dirname(fileURLToPath(import.meta.url))
      const skillPath = resolve(moduleDirectory, '../SKILL.md')
      return { path: skillPath, raw: readFileSync(skillPath, 'utf8') }
    } catch {
      return null
    }
  }

  function bundledSkillProvider() {
    // The file is read on every list/get so editing SKILL.md takes effect without
    // reinstalling the plugin; a missing file degrades to "no candidates" instead
    // of throwing inside apply().
    const summary = () => {
      const bundled = readBundledSkill()
      const skillPath = bundled?.path
      return {
        bundled,
        skillPath,
        base: {
          name: SKILL_NAME,
          description: SKILL_DESCRIPTION,
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'bundled' as const,
          provider: SKILL_NAME,
          ...(skillPath ? { path: skillPath, resourceBase: { kind: 'directory' as const, path: dirname(skillPath) } } : {}),
        },
      }
    }
    return {
      name: SKILL_NAME,
      list: () => {
        const { bundled, skillPath, base } = summary()
        return Promise.resolve(bundled ? [{ ...base, rank: 600, locator: skillPath }] : [])
      },
      get: () => {
        const { bundled, base } = summary()
        return Promise.resolve(bundled ? { ...base, content: bundled.raw } : undefined)
      },
    }
  }

  // The skills registry is an optional capability: keep the access untyped so a
  // missing or reshaped service can never break the hub, and never let a failed
  // registration escape into apply().
  ctx.inject(['skills'], (skillCtx) => {
    const skills = (skillCtx as any).skills
    if (!skills || typeof skills.registerProvider !== 'function') return
    try {
      skillCtx.effect(() => skills.registerProvider(() => bundledSkillProvider()))
    } catch {
      // Ignore: the bundled skill is a convenience, not a requirement.
    }
  })

  const currentEffectiveSettings = (): PersonaHubSettings => {
    const raw = {
      enabled: entry.enabled.get(),
      activePersona: entry.activePersona.get(),
      preferredImageMode: entry.preferredImageMode.get(),
      scanExternalDirs: entry.scanExternalDirs.get(),
      externalPluginsDir: entry.externalPluginsDir.get(),
      timeFallback: entry.timeFallback.get(),
      timeZone: entry.timeZone.get(),
    }
    if (raw.enabled !== lastEntrySnapshot.enabled) delete runtimeOverrides.enabled
    if (raw.activePersona !== lastEntrySnapshot.activePersona) delete runtimeOverrides.activePersona
    if (raw.preferredImageMode !== lastEntrySnapshot.preferredImageMode) delete runtimeOverrides.preferredImageMode
    if (raw.scanExternalDirs !== lastEntrySnapshot.scanExternalDirs) delete runtimeOverrides.scanExternalDirs
    if (raw.externalPluginsDir !== lastEntrySnapshot.externalPluginsDir) delete runtimeOverrides.externalPluginsDir
    if (raw.timeFallback !== lastEntrySnapshot.timeFallback) delete runtimeOverrides.timeFallback
    if (raw.timeZone !== lastEntrySnapshot.timeZone) delete runtimeOverrides.timeZone
    lastEntrySnapshot = raw
    return readSettings(entry, runtimeOverrides)
  }

  // Optional dependency, never a hard one: probe the sibling plugin and fall back
  // to our own time block whenever it is missing or not injecting time.
  const timeInjector: TimeInjector = createTimeInjector(ctx)
  ctx.effect(() => () => timeInjector.dispose())

  // The settings section component (and its nav entry) is registered by the
  // client half; the host only has to serve this namespace's volatile fields.
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // 1. Serve persona asset images (/api/persona-hub/image?plugin=...&file=...)
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/persona-hub/image',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return replyJson(res, 405, { ok: false, error: 'method not allowed' })
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const plugin = url.searchParams.get('plugin') || ''
        const file = url.searchParams.get('file') || ''
        const resolved = resolvePersonaAssetFile(currentEffectiveSettings(), plugin, file)
        if (!resolved) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        try {
          const buf = readFileSync(resolved.filePath)
          res.statusCode = 200
          res.setHeader('content-type', resolved.contentType)
          res.setHeader('cache-control', 'no-cache')
          if (req.method === 'HEAD') {
            res.end()
          } else {
            res.end(buf)
          }
        } catch {
          res.statusCode = 500
          res.end('Read error')
        }
      },
    }),
  )

  // 2. Serve live Persona Hub status & telemetry (/api/persona-hub/status?sessionId=...)
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/persona-hub/status',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          return replyJson(res, 405, { ok: false, error: 'method not allowed' })
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('conversationId') || null
        const settings = currentEffectiveSettings()
        const now = new Date()
        const personas = discoverPersonas(settings, now)
        const usage = getDshUsageTelemetry(ctx, sessionId, now.getTime())
        const promptPreview = buildPersonaSystemPrompt(settings, now, usage.convUserTurns)

        void timeInjector.refresh()

        return replyJson(res, 200, {
          ok: true,
          timestamp: now.toISOString(),
          settings,
          personas,
          usage,
          promptPreview,
          time: timeInjector.report(settings, now),
        })
      },
    }),
  )

  // 3. One-click persona & image-mode switching (/api/persona-hub/switch)
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/persona-hub/switch',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          return replyJson(res, 405, { ok: false, error: 'method not allowed' })
        }
        try {
          const body = await readJson(req)
          const patch: Partial<PersonaHubSettings> = {}
          if (typeof body.enabled === 'boolean') {
            runtimeOverrides.enabled = body.enabled
            patch.enabled = body.enabled
          }
          if (typeof body.activePersona === 'string') {
            const clean = body.activePersona.trim() || 'none'
            runtimeOverrides.activePersona = clean
            patch.activePersona = clean
          }
          if (body.preferredImageMode === 'realistic' || body.preferredImageMode === 'secondary') {
            runtimeOverrides.preferredImageMode = body.preferredImageMode
            patch.preferredImageMode = body.preferredImageMode
          }
          if (typeof body.scanExternalDirs === 'boolean') {
            runtimeOverrides.scanExternalDirs = body.scanExternalDirs
            patch.scanExternalDirs = body.scanExternalDirs
          }
          if (typeof body.externalPluginsDir === 'string') {
            runtimeOverrides.externalPluginsDir = body.externalPluginsDir.trim()
            patch.externalPluginsDir = body.externalPluginsDir.trim()
          }
          if (body.timeFallback === 'auto' || body.timeFallback === 'always' || body.timeFallback === 'off') {
            runtimeOverrides.timeFallback = body.timeFallback
            patch.timeFallback = body.timeFallback
          }
          if (typeof body.timeZone === 'string') {
            runtimeOverrides.timeZone = body.timeZone.trim()
            patch.timeZone = body.timeZone.trim()
          }

          void persistSettingsToConfigEditor(ctx, patch)

          const settings = currentEffectiveSettings()
          const now = new Date()
          const personas = discoverPersonas(settings, now)
          const usage = getDshUsageTelemetry(ctx, null, now.getTime())
          const promptPreview = buildPersonaSystemPrompt(settings, now, usage.convUserTurns)

          // Notify systemPrompt listeners that the active persona prompt changed
          try {
            ;(ctx as any).emit?.('system-prompt/change')
          } catch {
            // Ignore emit error
          }

          return replyJson(res, 200, {
            ok: true,
            settings,
            personas,
            usage,
            promptPreview,
            time: timeInjector.report(settings, now),
          })
        } catch (error) {
          return replyJson(res, 400, { ok: false, error: String(error) })
        }
      },
    }),
  )

  // 4. Register dynamic systemPrompt section
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'persona-hub',
      order: entry.sectionOrder,
      interpolate: false,
      text: (_assembly: AssembleContext) => {
        const settings = currentEffectiveSettings()
        const now = new Date()
        const usage = getDshUsageTelemetry(ctx, null, now.getTime())
        return buildPersonaSystemPrompt(settings, now, usage.convUserTurns)
      },
    }),
  )

  // 5. Self-sufficient time grounding. Empty whenever `dsh-environment-context`
  //    is already injecting the time itself, so nothing is duplicated; and it
  //    keeps injecting when that plugin is absent, disabled, or time-less.
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'persona-hub-time',
      order: entry.timeSectionOrder,
      interpolate: false,
      text: (_assembly: AssembleContext) => {
        void timeInjector.refresh()
        return timeInjector.compose(currentEffectiveSettings())
      },
    }),
  )
}
