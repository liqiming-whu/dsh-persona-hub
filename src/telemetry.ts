import type { Context } from '@deepseek-ai/cordis'

export interface UsageTelemetry {
  available: boolean
  currentModel: string
  convId: string | null
  convSteps: number
  convUserTurns: number
  convImages: number
  convContextKB: number
  contextLoadPct: number
  pressureTokens: number
  contextWindow: number
  todaySteps: number
  todayImages: number
  todayConvs: number
}

interface ParsedSessionStats {
  id: string
  isSubagent: boolean
  lastTime: number
  steps: number
  userTurns: number
  imageCalls: number
  latestModel: string | null
  contextWindow: number
  bytes: number
}

const IMAGE_TOOL_NAMES = new Set([
  'codex_image_generate',
  'image-generator',
  'generate_image',
])

export function inspectSessionEvents(session: any): ParsedSessionStats {
  let steps = 0
  let userTurns = 0
  let imageCalls = 0
  let latestModel: string | null = null
  let contextWindow = 0
  let bytes = 0
  let lastTime = Number(session?.header?.createdAt || 0)

  const events: readonly any[] = typeof session?.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : []

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    if (typeof ev.time === 'number' && ev.time > lastTime) {
      lastTime = ev.time
    }
    try {
      bytes += JSON.stringify(ev.data ?? {}).length
    } catch {
      // Ignore serialization errors
    }

    switch (ev.type) {
      case 'step/start':
        steps++
        break
      case 'user/message':
        userTurns++
        break
      case 'tool/call': {
        const toolName = String(ev.data?.name || '')
        if (IMAGE_TOOL_NAMES.has(toolName) || toolName.includes('image_generate')) {
          imageCalls++
        }
        break
      }
      case 'request/header': {
        const cfg = ev.data?.header?.config
        if (cfg?.model) {
          latestModel = cfg.reasoningEffort
            ? `${cfg.model} (${cfg.reasoningEffort})`
            : String(cfg.model)
        }
        break
      }
      case 'request/context': {
        if (ev.data?.model && !latestModel) {
          latestModel = String(ev.data.model)
        }
        if (typeof ev.data?.contextWindow === 'number' && ev.data.contextWindow > 0) {
          contextWindow = ev.data.contextWindow
        }
        break
      }
      case 'assistant/message': {
        const src = ev.data?.message?.source
        if (src?.model && !latestModel) {
          latestModel = String(src.model)
        }
        break
      }
    }
  }

  return {
    id: String(session?.id || ''),
    isSubagent: session?.header?.origin === 'subagent',
    lastTime,
    steps,
    userTurns,
    imageCalls,
    latestModel,
    contextWindow,
    bytes,
  }
}

export function getDshUsageTelemetry(
  ctx: Context,
  requestedSessionId?: string | null,
  nowMs: number = Date.now(),
): UsageTelemetry {
  const anyCtx = ctx as any
  const sessionsService = typeof anyCtx.get === 'function' ? anyCtx.get('sessions') : anyCtx.sessions
  const tokenMeter = typeof anyCtx.get === 'function' ? anyCtx.get('tokenMeter') : anyCtx.tokenMeter
  const defaultModelService = typeof anyCtx.get === 'function'
    ? anyCtx.get('agentDefaultModel')
    : anyCtx.agentDefaultModel

  let defaultModelLabel = 'DSH Default'
  try {
    const sel = defaultModelService?.currentSelection?.()
    if (sel?.model) {
      defaultModelLabel = sel.reasoningEffort
        ? `${sel.model} (${sel.reasoningEffort})`
        : String(sel.model)
    }
  } catch {
    // Keep fallback label
  }

  const rawSessions: any[] = typeof sessionsService?.list === 'function'
    ? sessionsService.list()
    : []

  if (rawSessions.length === 0) {
    return {
      available: true,
      currentModel: defaultModelLabel,
      convId: null,
      convSteps: 0,
      convUserTurns: 0,
      convImages: 0,
      convContextKB: 0,
      contextLoadPct: 0,
      pressureTokens: 0,
      contextWindow: 200000,
      todaySteps: 0,
      todayImages: 0,
      todayConvs: 0,
    }
  }

  const parsed = rawSessions.map(s => ({
    session: s,
    stats: inspectSessionEvents(s),
  }))

  // Prefer root sessions over subagents when picking the active conversation
  const sorted = [...parsed].sort((a, b) => {
    if (a.stats.isSubagent !== b.stats.isSubagent) {
      return a.stats.isSubagent ? 1 : -1
    }
    return b.stats.lastTime - a.stats.lastTime
  })

  const target =
    (requestedSessionId && sorted.find(x => x.stats.id === requestedSessionId)) ||
    sorted[0] ||
    null

  const DAY_MS = 24 * 60 * 60 * 1000
  let todaySteps = 0
  let todayImages = 0
  let todayConvs = 0
  let fallbackModel = target?.stats.latestModel || null

  for (const item of sorted) {
    if (nowMs - item.stats.lastTime <= DAY_MS) {
      if (!item.stats.isSubagent) {
        todayConvs++
      }
      todaySteps += item.stats.steps
      todayImages += item.stats.imageCalls
      if (!fallbackModel && item.stats.latestModel) {
        fallbackModel = item.stats.latestModel
      }
    }
  }

  let pressureTokens = 0
  let contextWindow = target?.stats.contextWindow || 200000

  if (target?.session && tokenMeter) {
    try {
      const pressure = tokenMeter.contextPressure?.(target.session)
      if (typeof pressure?.contextWindow === 'number' && pressure.contextWindow > 0) {
        contextWindow = pressure.contextWindow
      }
      if (typeof pressure?.pressureTokens === 'number' && pressure.pressureTokens > 0) {
        pressureTokens = pressure.pressureTokens
      } else if (typeof tokenMeter.measure === 'function') {
        const m = tokenMeter.measure(target.session)
        if (typeof m?.totalTokens === 'number' && m.totalTokens > 0) {
          pressureTokens = m.totalTokens
        }
      }
    } catch {
      // Fallback to byte estimation
    }
  }

  const convContextKB = target
    ? Math.round((target.stats.bytes / 1024) * 10) / 10
    : 0

  let contextLoadPct = 0
  if (pressureTokens > 0 && contextWindow > 0) {
    contextLoadPct = Math.min(100, Math.max(1, Math.round((pressureTokens / contextWindow) * 100)))
  } else if (convContextKB > 0) {
    contextLoadPct = Math.min(100, Math.round((convContextKB / 400) * 100))
  }

  return {
    available: true,
    currentModel: fallbackModel || defaultModelLabel,
    convId: target ? target.stats.id : null,
    convSteps: target ? target.stats.steps : 0,
    convUserTurns: target ? target.stats.userTurns : 0,
    convImages: target ? target.stats.imageCalls : 0,
    convContextKB,
    contextLoadPct,
    pressureTokens,
    contextWindow,
    todaySteps,
    todayImages,
    todayConvs,
  }
}
