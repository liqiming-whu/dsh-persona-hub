import type { Context } from '@deepseek-ai/cordis'
import type { PersonaHubSettings, TimeFallbackMode } from './personas.ts'

/**
 * The Persona Console must never *depend* on another plugin to keep the model
 * grounded in real time for questions and reasoning that depend on the current date.
  *
  * `dsh-environment-context` is therefore treated as an OPTIONAL enrichments
  * provider. When it is installed and injecting, we stay silent (no duplicate
  * time line). When it is missing, disabled, or has `injectTime` turned off, we
  * inject a compact fallback block ourselves.
  */

const PROBE_PATH = '/api/environment-context/snapshot'
const PROBE_TTL_MS = 10_000
const PROBE_INTERVAL_MS = 10_000
const PROBE_TIMEOUT_MS = 2_500

const TIME_LINE_MARKERS = ['当前时间', 'Local time']

export type EnvironmentContextState = 'active' | 'absent' | 'unknown'

export interface TimeProbeState {
  environmentContext: EnvironmentContextState
  providesTime: boolean
  checkedAt: number
  detail: string
}

export interface TimeInjectionReport {
  mode: TimeFallbackMode
  environmentContext: EnvironmentContextState
  providesTime: boolean
  injected: boolean
  source: 'environment-context' | 'persona-hub' | 'none'
  text: string
  timeZone: string
  detail: string
  checkedAt: number
}

export interface CreateTimeInjectorOptions {
  /** Start the background probe timer (default true; tests pass false). */
  autoStart?: boolean
}

export interface TimeInjector {
  refresh(force?: boolean): Promise<void>
  state(): TimeProbeState
  compose(settings: PersonaHubSettings, now?: Date): string
  report(settings: PersonaHubSettings, now?: Date): TimeInjectionReport
  dispose(): void
}

function partOf(parts: Intl.DateTimeFormatPart[], type: string): string {
  for (const part of parts) {
    if (part.type === type) return part.value
  }
  return ''
}

export function resolveTimeZone(configured?: string): string {
  const trimmed = String(configured ?? '').trim()
  if (trimmed) {
    try {
      // Throws RangeError for an unknown IANA zone; fall through to the system zone.
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date())
      return trimmed
    } catch {
      // Ignore invalid configured zone
    }
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function formatUtcOffset(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      timeZoneName: 'longOffset',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const raw = partOf(parts, 'timeZoneName')
    if (!raw) return ''
    if (raw === 'GMT') return 'UTC+00:00'
    if (raw.startsWith('GMT')) return `UTC${raw.slice(3)}`
    return raw
  } catch {
    return ''
  }
}

/**
 * Compact, locale-aware reality-time block used only when nothing else supplies
 * the current time. Mirrors `dsh-environment-context`'s 【现实环境信息】 header so
 * the model reads one consistent structure regardless of the provider.
 */
export function formatFallbackTimeBlock(
  now: Date,
  options: { timeZone?: string; locale?: string } = {},
): string {
  const requested = String(options.locale ?? '').trim() || systemLocale()
  const english = requested.toLowerCase().startsWith('en')
  const zone = resolveTimeZone(options.timeZone)

  const numeric = new Intl.DateTimeFormat('en-US', {
    timeZone: zone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const year = partOf(numeric, 'year')
  const month = partOf(numeric, 'month')
  const day = partOf(numeric, 'day')
  const hour = partOf(numeric, 'hour')
  const minute = partOf(numeric, 'minute')
  const second = partOf(numeric, 'second')

  const weekday = new Intl.DateTimeFormat(english ? 'en-US' : 'zh-CN', {
    timeZone: zone || undefined,
    weekday: 'long',
  }).format(now)

  const offset = formatUtcOffset(now, zone)
  const stamp = `${year}-${month}-${day} ${hour}:${minute}:${second}`

  if (english) {
    const lines = ['[Current environment]', `Local time: ${stamp}`]
    if (zone) lines.push(`Time zone: ${zone}${offset ? ` (${offset})` : ''}`)
    lines.push(`Weekday: ${weekday}`)
    return lines.join('\n')
  }

  const lines = [
    '【现实环境信息】',
    `当前时间：${Number(year)}年${Number(month)}月${Number(day)}日 ${hour}:${minute}:${second}`,
  ]
  if (zone) lines.push(`时区：${zone}${offset ? ` (${offset})` : ''}`)
  lines.push(`星期：${weekday}`)
  return lines.join('\n')
}

function probeSignal(): AbortSignal | undefined {
  try {
    const factory = (globalThis as any).AbortSignal
    if (factory && typeof factory.timeout === 'function') return factory.timeout(PROBE_TIMEOUT_MS)
  } catch {
    // Fall through to an unbounded probe
  }
  return undefined
}

/**
 * Ask the sibling plugin's own route what it would inject right now. This is the
 * authoritative signal: a 200 with `ok: true` means the plugin is loaded and
 * serving, and its `prompt` string tells us whether it already covers the time.
 */
async function probeEnvironmentContext(origin: string): Promise<TimeProbeState> {
  const now = Date.now()
  if (!origin) {
    return {
      environmentContext: 'unknown',
      providesTime: false,
      checkedAt: now,
      detail: '无法解析本机 Web 服务地址',
    }
  }

  try {
    const response = await fetch(`${origin}${PROBE_PATH}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: probeSignal(),
    })

    let payload: any = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok || !payload || payload.ok !== true) {
      return {
        environmentContext: 'absent',
        providesTime: false,
        checkedAt: now,
        detail: `未由 dsh-environment-context 提供（HTTP ${response.status}）`,
      }
    }

    const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
    const providesTime = TIME_LINE_MARKERS.some(marker => prompt.includes(marker))
    return {
      environmentContext: 'active',
      providesTime,
      checkedAt: now,
      detail: providesTime
        ? 'dsh-environment-context 在线且正在注入时间'
        : 'dsh-environment-context 在线但未注入时间（enabled 或 injectTime 已关闭）',
    }
  } catch (error) {
    return {
      environmentContext: 'unknown',
      providesTime: false,
      checkedAt: now,
      detail: `探测失败：${String((error as any)?.message ?? error)}`,
    }
  }
}

export function createTimeInjector(
  ctx: Context,
  options: CreateTimeInjectorOptions = {},
): TimeInjector {
  let cached: TimeProbeState = {
    environmentContext: 'unknown',
    providesTime: false,
    checkedAt: 0,
    detail: '尚未探测',
  }
  let inflight: Promise<void> | null = null
  let timer: any = null

  const originOf = (): string => {
    try {
      const webServer = (ctx as any).webServer
      const origin = typeof webServer?.getOrigin === 'function' ? webServer.getOrigin() : ''
      if (typeof origin === 'string' && origin.startsWith('http')) {
        return origin.replace(/\/+$/, '')
      }
    } catch {
      // Fall through to "unknown"
    }
    return ''
  }

  const refresh = async (force = false): Promise<void> => {
    const fresh = Date.now() - cached.checkedAt < PROBE_TTL_MS
    if (!force && cached.environmentContext !== 'unknown' && fresh) return
    if (inflight) {
      await inflight
      return
    }
    inflight = (async () => {
      cached = await probeEnvironmentContext(originOf())
    })()
    try {
      await inflight
    } finally {
      inflight = null
    }
  }

  const block = (settings: PersonaHubSettings, now: Date): string =>
    formatFallbackTimeBlock(now, { timeZone: settings.timeZone, locale: systemLocale() })

  const compose = (settings: PersonaHubSettings, now: Date = new Date()): string => {
    const mode = (settings.timeFallback || 'auto') as TimeFallbackMode
    if (mode === 'off') return ''
    if (mode === 'always') return block(settings, now)
    if (cached.environmentContext === 'active' && cached.providesTime) return ''
    return block(settings, now)
  }

  const report = (settings: PersonaHubSettings, now: Date = new Date()): TimeInjectionReport => {
    const mode = (settings.timeFallback || 'auto') as TimeFallbackMode
    const text = compose(settings, now)
    const source: TimeInjectionReport['source'] =
      mode === 'off'
        ? 'none'
        : text
          ? 'persona-hub'
          : 'environment-context'
    return {
      mode,
      environmentContext: cached.environmentContext,
      providesTime: cached.providesTime,
      injected: Boolean(text),
      source,
      text,
      timeZone: resolveTimeZone(settings.timeZone),
      detail: cached.detail,
      checkedAt: cached.checkedAt,
    }
  }

  if (options.autoStart !== false) {
    void refresh(true)
    timer = setInterval(() => {
      void refresh()
    }, PROBE_INTERVAL_MS)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  return {
    refresh,
    state: () => cached,
    compose,
    report,
    dispose: () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
