import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-host-webserver'
import '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { registerPersonaState, replyJson } from './host-state.ts'
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

type VolatileFields = Required<PersonaHubSettings> & { sessionPersonas: Record<string, string> }
type OrderSchema = Schemastery<number, number, 'defined'>
type ConfigFields = {
  [K in keyof VolatileFields]: Schemastery<VolatileFields[K], VolatileFields[K], 'volatile-defined'>
} & { timeSectionOrder: OrderSchema; sectionOrder: OrderSchema }

export const Config: ReturnType<typeof z.object<ConfigFields>> = z.object({
  enabled: z.boolean().default(true).volatile(),
  activePersona: z.string().default('hajimi-persona').volatile(),
  preferredImageMode: z.union(['realistic', 'secondary']).default('realistic').volatile(),
  scanExternalDirs: z.boolean().default(true).volatile(),
  externalPluginsDir: z.string().default('').volatile(),
  showSidebarCard: z.boolean().default(true).volatile(),
  sidebarCardWidth: z.union([0, z.number().min(160).max(480).step(1)]).default(0).volatile(),
  sessionPersonas: z.dict(z.string()).default({}).volatile(),
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
    showSidebarCard: overrides.showSidebarCard ?? entry.showSidebarCard.get(),
    sidebarCardWidth: overrides.sidebarCardWidth ?? entry.sidebarCardWidth.get(),
    timeFallback: (overrides.timeFallback ?? entry.timeFallback.get()) as TimeFallbackMode,
    timeZone: overrides.timeZone ?? entry.timeZone.get(),
  }
}

export function apply(ctx: Context, entry: Config): void {
  const SKILL_NAME = 'persona-assistant'
  const SKILL_DESCRIPTION = '人设管理助手：指导创建、导入（本地目录 / GitHub 仓库）、移植与适配 DSH 人设插件，并说明人设控制台的面板、切换与删除操作。'

  /** A missing SKILL.md must never break plugin apply. */
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

  // Optional dependency, never a hard one: probe the sibling plugin and fall back
  // to our own time block whenever it is missing or not injecting time.
  const timeInjector: TimeInjector = createTimeInjector(ctx)
  ctx.effect(() => () => timeInjector.dispose())

  // The settings section component (and its nav entry) is registered by the
  // client half; the host only has to serve this namespace's volatile fields.
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // Serve persona asset images (/api/persona-hub/image?plugin=...&file=...).
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
        const resolved = resolvePersonaAssetFile(readSettings(entry), plugin, file)
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

  registerPersonaState(ctx, {
    readSettings: () => readSettings(entry),
    readBindings: () => entry.sessionPersonas.get(),
    sectionOrder: entry.sectionOrder,
    timeInjector,
  })

  // Self-sufficient time grounding. Empty whenever `dsh-environment-context`
  // is already injecting the time itself, so nothing is duplicated; and it
  // keeps injecting when that plugin is absent, disabled, or time-less.
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'persona-hub-time',
      order: entry.timeSectionOrder,
      interpolate: false,
      text: () => {
        void timeInjector.refresh()
        return timeInjector.compose(readSettings(entry))
      },
    }),
  )
}
