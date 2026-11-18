import React, { useCallback, useEffect, useState } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  ImageMode,
  PersonaHubSettings,
  PersonaItem,
  PersonasSnapshot,
  TimeFallbackMode,
  UsageTelemetry,
} from '../index.ts'

export interface TimeReport {
  mode: TimeFallbackMode
  environmentContext: 'active' | 'absent' | 'unknown'
  providesTime: boolean
  injected: boolean
  source: 'environment-context' | 'persona-hub' | 'none'
  text: string
  timeZone: string
  detail: string
  checkedAt: number
}

export interface HubStatusPayload {
  ok: boolean
  timestamp: string
  settings: PersonaHubSettings
  personas: PersonasSnapshot
  usage: UsageTelemetry
  promptPreview: string
  time?: TimeReport
}

type Listener = () => void

const WIDTH_STORAGE_KEY = 'dsh-persona-hub.drawerWidth'
const DOCK_MODE_STORAGE_KEY = 'dsh-persona-hub.pushLayout'

function readSavedWidth(): number {
  try {
    const raw = Number(globalThis.localStorage?.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(raw) && raw >= 300 && raw <= 780) return Math.round(raw)
  } catch {}
  return 420
}

function readSavedPushMode(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(DOCK_MODE_STORAGE_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {}
  return true
}

interface SharedClientState {
  drawerOpen: boolean
  drawerWidth: number
  pushLayout: boolean
  activeSessionId: string | null
  inputActions: any | null
  latestStatus: HubStatusPayload | null
}

const sharedState: SharedClientState = {
  drawerOpen: false,
  drawerWidth: readSavedWidth(),
  pushLayout: readSavedPushMode(),
  activeSessionId: null,
  inputActions: null,
  latestStatus: null,
}

const listeners = new Set<Listener>()

export function subscribeSharedState(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSharedState(): SharedClientState {
  return sharedState
}

export function updateSharedState(patch: Partial<SharedClientState>): void {
  if (typeof patch.drawerWidth === 'number') {
    const clamped = Math.max(300, Math.min(780, Math.round(patch.drawerWidth)))
    patch.drawerWidth = clamped
    try {
      globalThis.localStorage?.setItem(WIDTH_STORAGE_KEY, String(clamped))
    } catch {}
  }
  if (typeof patch.pushLayout === 'boolean') {
    try {
      globalThis.localStorage?.setItem(DOCK_MODE_STORAGE_KEY, patch.pushLayout ? '1' : '0')
    } catch {}
  }
  Object.assign(sharedState, patch)
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // Ignore listener error
    }
  }
}

export async function fetchHubStatus(sessionId?: string | null): Promise<HubStatusPayload> {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const res = await fetch(`/api/persona-hub/status${qs}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as HubStatusPayload
  updateSharedState({ latestStatus: data })
  return data
}

export async function postHubSwitch(
  patch: Partial<PersonaHubSettings>,
  scope?: ConfigForm<PersonaHubSettings>,
): Promise<HubStatusPayload> {
  if (scope) {
    for (const [k, v] of Object.entries(patch)) {
      try {
        void scope.set(k as keyof PersonaHubSettings, v as any)
      } catch {
        // Ignore configForm error and rely on POST /api/persona-hub/switch
      }
    }
  }
  const res = await fetch('/api/persona-hub/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as HubStatusPayload
  updateSharedState({ latestStatus: data })
  return data
}

/**
 * Official DSH theme tokens (verified via Theme.listTokens):
 * --dsw-alias-label-primary: Primary text color
 * --dsw-alias-label-secondary: Secondary text color
 * --dsw-alias-label-tertiary: Tertiary muted text color
 * --dsw-alias-bg-base: Base background
 * --dsw-alias-bg-layer-1: Primary card surface
 * --dsw-alias-bg-layer-2: Secondary nested surface
 * --dsw-alias-bg-overlay: Overlay / popover surface
 * --dsw-alias-border-l1 / --dsw-alias-border-l2: Theme borders
 * --dsw-alias-brand-primary: Brand accent color
 */
export const DSH_TOKENS = {
  textPrimary: 'var(--dsw-alias-label-primary, #f1f5f9)',
  textSecondary: 'var(--dsw-alias-label-secondary, #cbd5e1)',
  textTertiary: 'var(--dsw-alias-label-tertiary, #94a3b8)',
  bgBase: 'var(--dsh-dream-skin-modal-base, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base, #0f172a)))',
  bgCard: 'var(--dsw-alias-bg-layer-1, rgba(30, 41, 59, 0.75))',
  bgSurface: 'var(--dsw-alias-bg-layer-2, rgba(51, 65, 85, 0.55))',
  borderSubtle: 'var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.2))',
  borderStrong: 'var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.32))',
  brand: 'var(--dsw-alias-brand-primary, #6366f1)',
  brandSoft: 'var(--dsw-alias-brand-primary-soft, rgba(99, 102, 241, 0.16))',
  hoverBg: 'var(--dsw-alias-interactive-bg-hover, rgba(148, 163, 184, 0.12))',
}

const TONE_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  indigo: {
    bg: 'color-mix(in srgb, #6366f1 18%, transparent)',
    color: 'color-mix(in srgb, #6366f1 55%, var(--dsw-alias-label-primary, #e0e7ff))',
    border: 'color-mix(in srgb, #6366f1 42%, transparent)',
  },
  amber: {
    bg: 'color-mix(in srgb, #f59e0b 18%, transparent)',
    color: 'color-mix(in srgb, #f59e0b 65%, var(--dsw-alias-label-primary, #fef3c7))',
    border: 'color-mix(in srgb, #f59e0b 42%, transparent)',
  },
  rose: {
    bg: 'color-mix(in srgb, #f43f5e 18%, transparent)',
    color: 'color-mix(in srgb, #f43f5e 62%, var(--dsw-alias-label-primary, #ffe4e6))',
    border: 'color-mix(in srgb, #f43f5e 42%, transparent)',
  },
  sky: {
    bg: 'color-mix(in srgb, #0ea5e9 18%, transparent)',
    color: 'color-mix(in srgb, #0ea5e9 65%, var(--dsw-alias-label-primary, #e0f2fe))',
    border: 'color-mix(in srgb, #0ea5e9 42%, transparent)',
  },
  emerald: {
    bg: 'color-mix(in srgb, #10b981 18%, transparent)',
    color: 'color-mix(in srgb, #10b981 65%, var(--dsw-alias-label-primary, #d1fae5))',
    border: 'color-mix(in srgb, #10b981 42%, transparent)',
  },
}

function formatTokens(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const TIME_MODE_OPTIONS: Array<{ mode: TimeFallbackMode; label: string; hint: string }> = [
  { mode: 'auto', label: '自动', hint: 'dsh-environment-context 优先，缺失或关闭时自动接管' },
  { mode: 'always', label: '始终兜底', hint: '无论环境上下文是否在线，都注入内置时间块' },
  { mode: 'off', label: '关闭', hint: '完全不注入时间（仅当你有其他时间来源时使用）' },
]

const ENVIRONMENT_LABELS: Record<string, string> = {
  active: '在线',
  absent: '未检测到',
  unknown: '待确认',
}

export interface HubPanelProps {
  scope?: ConfigForm<PersonaHubSettings>
  compact?: boolean
  showAdvancedConfig?: boolean
  onCloseDrawer?: () => void
  showDockControls?: boolean
}

export function HubPanel({
  scope,
  compact = false,
  showAdvancedConfig = false,
  onCloseDrawer,
  showDockControls = false,
}: HubPanelProps) {
  const [statusData, setStatusData] = useState<HubStatusPayload | null>(sharedState.latestStatus)
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null)
  const [selectedImageMode, setSelectedImageMode] = useState<ImageMode>('realistic')
  const [syncLabel, setSyncLabel] = useState('实时同步中')
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const [pushLayout, setPushLayout] = useState(sharedState.pushLayout)

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => {
      setToastMsg(prev => (prev === msg ? null : prev))
    }, 2000)
  }, [])

  const refresh = useCallback(async () => {
    setSyncLabel('同步中...')
    try {
      const data = await fetchHubStatus(sharedState.activeSessionId)
      setStatusData(data)
      if (data.settings?.preferredImageMode) {
        setSelectedImageMode(data.settings.preferredImageMode)
      }
      setSyncLabel('实时同步中')
    } catch {
      setSyncLabel('重连中...')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    const unsub = subscribeSharedState(() => {
      if (sharedState.latestStatus) {
        setStatusData(sharedState.latestStatus)
      }
      setPushLayout(sharedState.pushLayout)
    })
    return () => {
      clearInterval(timer)
      unsub()
    }
  }, [refresh])

  const handleSwitchPersona = async (personaId: string) => {
    try {
      setSyncLabel('正在切换...')
      const data = await postHubSwitch(
        {
          enabled: personaId !== 'none',
          activePersona: personaId,
        },
        scope,
      )
      setStatusData(data)
      setSyncLabel('实时同步中')
      if (personaId === 'none') {
        showToast('已切回 DSH 标准助手模式 ✨')
      } else {
        const target = data.personas.allPersonas.find(p => p.id === personaId)
        showToast(`已激活人设：${target?.displayName.split(' ')[0] || personaId} ✨`)
      }
    } catch (err) {
      showToast(`切换失败：${String(err)}`)
      setSyncLabel('重试')
    }
  }

  const handleSwitchImageMode = async (mode: ImageMode) => {
    setSelectedImageMode(mode)
    try {
      const data = await postHubSwitch({ preferredImageMode: mode }, scope)
      setStatusData(data)
      showToast(
        mode === 'realistic'
          ? '已设为默认写实参考图模式 📸'
          : '已设为第二参考图 (二次元/九宫格) 模式 🎨',
      )
    } catch {
      // Keep local preview mode
    }
  }

  const handleTimeMode = async (mode: TimeFallbackMode) => {
    try {
      const data = await postHubSwitch({ timeFallback: mode }, scope)
      setStatusData(data)
      showToast(
        mode === 'off'
          ? '已关闭人设控制台的时间注入 🕒'
          : mode === 'always'
            ? '已强制使用内置时间兜底 🕒'
            : '已交给环境上下文优先注入 🕒',
      )
    } catch {
      showToast('时间注入设置失败，请稍后重试')
    }
  }

  const handlePromptClick = (promptText: string) => {
    navigator.clipboard?.writeText(promptText).catch(() => {})
    const actions = sharedState.inputActions
    if (actions && typeof actions.setText === 'function') {
      try {
        actions.setText(promptText)
        showToast('已填入聊天输入框并复制 ✨')
        return
      } catch {
        // Fallback to clipboard toast
      }
    }
    showToast('已复制唤醒词到剪贴板 ✨')
  }

  const personasData: PersonasSnapshot = statusData?.personas ?? {
    mode: 'none',
    activeCount: 0,
    preferredImageMode: 'realistic',
    activePersonas: [],
    allPersonas: [],
  }

  const usage: UsageTelemetry = statusData?.usage ?? {
    available: false,
    currentModel: 'DSH (默认)',
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

  const settings = statusData?.settings
  const timeReport: TimeReport | undefined = statusData?.time
  const timeMode: TimeFallbackMode = timeReport?.mode ?? settings?.timeFallback ?? 'auto'
  const timeBadge = timeReport && !timeReport.injected && timeReport.mode !== 'off'
    ? { label: '环境上下文生效', ...TONE_STYLES.emerald }
    : timeReport?.mode === 'off'
      ? { label: '已关闭时间注入', ...TONE_STYLES.indigo }
      : timeReport?.injected
        ? { label: '内置兜底已接管', ...TONE_STYLES.amber }
        : { label: '等待首次探测', ...TONE_STYLES.indigo }
  const defaultActive: PersonaItem | null = personasData.activePersonas[0] || null
  const targetPersona: PersonaItem | null = selectedPersonaId
    ? personasData.allPersonas.find(p => p.id === selectedPersonaId) || defaultActive
    : defaultActive

  const isPreviewingInactive = Boolean(targetPersona && !targetPersona.enabled)
  const hasSecondary = Boolean(targetPersona?.secondaryUrl)
  const showSecondary = hasSecondary && selectedImageMode === 'secondary'
  const currentImgUrl = targetPersona
    ? showSecondary
      ? targetPersona.secondaryUrl
      : targetPersona.realisticUrl || targetPersona.logoUrl
    : null

  const cardStyle: React.CSSProperties = {
    background: DSH_TOKENS.bgCard,
    border: `1px solid ${DSH_TOKENS.borderStrong}`,
    borderRadius: 14,
    padding: 14,
    color: DSH_TOKENS.textPrimary,
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
  }

  const surfaceStyle: React.CSSProperties = {
    background: DSH_TOKENS.bgSurface,
    border: `1px solid ${DSH_TOKENS.borderSubtle}`,
    borderRadius: 10,
    color: DSH_TOKENS.textPrimary,
  }

  const pct = usage.contextLoadPct || 0
  const barColor = pct >= 85 ? '#f43f5e' : pct >= 60 ? '#f59e0b' : '#10b981'

  return (
    <div
      style={{
        maxWidth: compact ? '100%' : 760,
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 13,
        lineHeight: 1.5,
        color: DSH_TOKENS.textPrimary,
        position: 'relative',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 2px',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontWeight: 700,
            fontSize: 14.5,
            color: DSH_TOKENS.textPrimary,
          }}
        >
          <span>✨ 人设控制台</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {showDockControls && (
            <button
              type="button"
              onClick={() => updateSharedState({ pushLayout: !pushLayout })}
              title={
                pushLayout
                  ? '当前为【推开会话】模式（不挡聊天内容），点击可切换为悬浮模式'
                  : '当前为【悬浮覆盖】模式，点击可切换为推开会话模式（不挡聊天内容）'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                background: pushLayout ? DSH_TOKENS.brandSoft : DSH_TOKENS.bgSurface,
                color: DSH_TOKENS.textPrimary,
                border: `1px solid ${pushLayout ? DSH_TOKENS.brand : DSH_TOKENS.borderStrong}`,
                padding: '3px 8px',
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              <span>{pushLayout ? '📌 推开会话' : '🪟 悬浮模式'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void refresh()}
            title="点击立即刷新状态"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11.5,
              fontWeight: 500,
              background: DSH_TOKENS.bgCard,
              color: DSH_TOKENS.textSecondary,
              border: `1px solid ${DSH_TOKENS.borderStrong}`,
              padding: '3px 9px',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 6px #10b981',
              }}
            />
            <span style={{ color: DSH_TOKENS.textPrimary }}>{syncLabel}</span>
          </button>

          {onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              title="收起侧边栏中控台"
              style={{
                border: `1px solid ${DSH_TOKENS.borderStrong}`,
                background: DSH_TOKENS.bgCard,
                color: DSH_TOKENS.textPrimary,
                borderRadius: 8,
                padding: '3px 8px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Section 1: Active Persona / Preview Showcase */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: DSH_TOKENS.textSecondary }}>
            {!targetPersona
              ? '当前运行状态'
              : isPreviewingInactive
                ? '人设图鉴预览（当前未启用）'
                : '当前激活人设'}
          </span>

          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 9px',
              borderRadius: 999,
              background:
                personasData.mode === 'none'
                  ? DSH_TOKENS.bgSurface
                  : personasData.mode === 'single'
                    ? TONE_STYLES.emerald.bg
                    : TONE_STYLES.amber.bg,
              color:
                personasData.mode === 'none'
                  ? DSH_TOKENS.textSecondary
                  : personasData.mode === 'single'
                    ? TONE_STYLES.emerald.color
                    : TONE_STYLES.amber.color,
              border: `1px solid ${
                personasData.mode === 'none'
                  ? DSH_TOKENS.borderSubtle
                  : personasData.mode === 'single'
                    ? TONE_STYLES.emerald.border
                    : TONE_STYLES.amber.border
              }`,
            }}
          >
            {personasData.mode === 'none'
              ? '未激活人设 · 标准模式'
              : personasData.mode === 'single'
                ? `当前启用：${defaultActive?.displayName.split(' ')[0]}`
                : `${personasData.activeCount} 个人设同时启用`}
          </span>
        </div>

        {personasData.mode === 'conflict' && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              fontSize: 12,
              marginBottom: 10,
              background: TONE_STYLES.amber.bg,
              color: DSH_TOKENS.textPrimary,
              border: `1px solid ${TONE_STYLES.amber.border}`,
            }}
          >
            ⚠️ 当前同时开启了 <b>{personasData.activeCount}</b> 个人设插件（
            {personasData.activePersonas.map(p => p.displayName).join('、')}
            ），建议在下方点击切换仅保留一个以避免风格冲突。
          </div>
        )}

        {!targetPersona ? (
          <div
            style={{
              ...surfaceStyle,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: 12,
              borderStyle: 'dashed',
            }}
          >
            <div style={{ fontSize: 24, lineHeight: 1 }}>🌟</div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 3, color: DSH_TOKENS.textPrimary }}>
                当前未激活任何专属人设插件（默认助手模式）
              </div>
              <div style={{ fontSize: 12, color: DSH_TOKENS.textSecondary }}>
                目前以 DSH 标准助手身份运行中。你可以点击下方「已安装人设图鉴」预览并一键开启哈基米、小克、小鲸鱼或林知微~
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Persona Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 10,
              }}
            >
              {targetPersona.logoUrl && (
                <img
                  src={targetPersona.logoUrl}
                  alt={targetPersona.displayName}
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 14,
                    objectFit: 'cover',
                    border: `2px solid ${DSH_TOKENS.brand}`,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      margin: 0,
                      color: DSH_TOKENS.textPrimary,
                    }}
                  >
                    {targetPersona.displayName}
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: targetPersona.enabled
                        ? TONE_STYLES.emerald.bg
                        : TONE_STYLES.indigo.bg,
                      color: targetPersona.enabled
                        ? TONE_STYLES.emerald.color
                        : TONE_STYLES.indigo.color,
                      border: `1px solid ${
                        targetPersona.enabled
                          ? TONE_STYLES.emerald.border
                          : TONE_STYLES.indigo.border
                      }`,
                    }}
                  >
                    {targetPersona.enabled ? '● 正在使用' : '○ 预览中 (未启用)'}
                  </span>
                </div>

                {targetPersona.badge && (
                  <div
                    style={{
                      display: 'inline-block',
                      marginTop: 5,
                      fontSize: 11.5,
                      padding: '2px 8px',
                      borderRadius: 6,
                      fontWeight: 500,
                      background: (TONE_STYLES[targetPersona.badge.tone] || TONE_STYLES.indigo).bg,
                      color: (TONE_STYLES[targetPersona.badge.tone] || TONE_STYLES.indigo).color,
                      border: `1px solid ${(TONE_STYLES[targetPersona.badge.tone] || TONE_STYLES.indigo).border}`,
                    }}
                  >
                    {targetPersona.badge.text}
                  </div>
                )}
              </div>

              {/* One-click Activate / Deactivate button */}
              <div>
                {targetPersona.enabled ? (
                  <button
                    type="button"
                    onClick={() => void handleSwitchPersona('none')}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: `1px solid ${TONE_STYLES.rose.border}`,
                      background: TONE_STYLES.rose.bg,
                      color: TONE_STYLES.rose.color,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    停用人设
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSwitchPersona(targetPersona.id)}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: `1px solid ${TONE_STYLES.emerald.border}`,
                      background: TONE_STYLES.emerald.bg,
                      color: TONE_STYLES.emerald.color,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ⚡ 启用此人设
                  </button>
                )}
              </div>
            </div>

            <div
              style={{
                fontSize: 12.5,
                color: DSH_TOKENS.textSecondary,
                margin: '8px 0 12px',
              }}
            >
              {targetPersona.description}
            </div>

            {/* Dual Portrait View Switcher */}
            {hasSecondary && (
              <div
                style={{
                  ...surfaceStyle,
                  display: 'flex',
                  gap: 6,
                  marginBottom: 12,
                  padding: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleSwitchImageMode('realistic')}
                  style={{
                    flex: 1,
                    border: !showSecondary ? `1px solid ${DSH_TOKENS.brand}` : '1px solid transparent',
                    background: !showSecondary ? DSH_TOKENS.brandSoft : 'transparent',
                    color: !showSecondary ? DSH_TOKENS.textPrimary : DSH_TOKENS.textSecondary,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 8px',
                    borderRadius: 7,
                    cursor: 'pointer',
                  }}
                >
                  📸 {targetPersona.realisticLabel || '写实形象 (默认)'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSwitchImageMode('secondary')}
                  style={{
                    flex: 1,
                    border: showSecondary ? `1px solid ${DSH_TOKENS.brand}` : '1px solid transparent',
                    background: showSecondary ? DSH_TOKENS.brandSoft : 'transparent',
                    color: showSecondary ? DSH_TOKENS.textPrimary : DSH_TOKENS.textSecondary,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 8px',
                    borderRadius: 7,
                    cursor: 'pointer',
                  }}
                >
                  🎨 {targetPersona.secondaryLabel || '二次元形象'}
                </button>
              </div>
            )}

            {/* Portrait Image */}
            {currentImgUrl && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                  margin: '4px 0 2px',
                }}
              >
                <img
                  src={currentImgUrl}
                  alt={targetPersona.displayName}
                  style={{
                    width: 'auto',
                    maxWidth: '100%',
                    maxHeight: compact ? 340 : 400,
                    borderRadius: 14,
                    border: `1px solid ${DSH_TOKENS.borderStrong}`,
                    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.14)',
                    display: 'block',
                  }}
                />
              </div>
            )}

            {/* Suggested Prompts */}
            {targetPersona.suggestedPrompts.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {targetPersona.suggestedPrompts.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePromptClick(p)}
                    title="点击复制或直接填入当前对话框"
                    style={{
                      ...surfaceStyle,
                      textAlign: 'left',
                      fontSize: 12,
                      padding: '8px 10px',
                      borderRadius: 8,
                      color: DSH_TOKENS.textPrimary,
                      cursor: 'pointer',
                    }}
                  >
                    💬 “{p}”
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Installed Persona Roster */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: DSH_TOKENS.textSecondary }}>
            已安装人设图鉴（点击卡片预览 · 点按钮直接切换）
          </span>
          {personasData.activeCount > 0 && (
            <button
              type="button"
              onClick={() => void handleSwitchPersona('none')}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 6,
                border: `1px solid ${DSH_TOKENS.borderStrong}`,
                background: DSH_TOKENS.bgSurface,
                color: DSH_TOKENS.textSecondary,
                cursor: 'pointer',
              }}
            >
              切回标准助手
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(Math.max(personasData.allPersonas.length, 1), 4)}, minmax(0, 1fr))`,
            gap: 6,
          }}
        >
          {personasData.allPersonas.map(p => {
            const shortName = p.displayName.split(' ')[0]
            const currentTargetId = selectedPersonaId || (defaultActive?.id ?? null)
            const isSelected = p.id === currentTargetId
            return (
              <div
                key={p.id}
                onClick={() => setSelectedPersonaId(prev => (prev === p.id ? null : p.id))}
                onDoubleClick={() => void handleSwitchPersona(p.enabled ? 'none' : p.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '8px 4px',
                  borderRadius: 10,
                  border: isSelected
                    ? `1.5px solid ${DSH_TOKENS.brand}`
                    : `1px solid ${DSH_TOKENS.borderSubtle}`,
                  background: isSelected ? DSH_TOKENS.brandSoft : DSH_TOKENS.bgSurface,
                  color: DSH_TOKENS.textPrimary,
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                  minWidth: 0,
                }}
              >
                {p.logoUrl ? (
                  <img
                    src={p.logoUrl}
                    alt={shortName}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      objectFit: 'cover',
                      marginBottom: 5,
                    }}
                  />
                ) : (
                  <div style={{ width: 38, height: 38, borderRadius: 10, marginBottom: 5 }} />
                )}
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: DSH_TOKENS.textPrimary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}
                >
                  {shortName}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    marginTop: 2,
                    fontWeight: p.enabled ? 700 : 500,
                    color: p.enabled ? TONE_STYLES.emerald.color : DSH_TOKENS.textTertiary,
                  }}
                >
                  {p.enabled ? '● 已激活' : '未激活'}
                </div>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    void handleSwitchPersona(p.enabled ? 'none' : p.id)
                  }}
                  style={{
                    marginTop: 5,
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 6,
                    border: `1px solid ${
                      p.enabled ? TONE_STYLES.emerald.border : DSH_TOKENS.borderStrong
                    }`,
                    background: p.enabled ? TONE_STYLES.emerald.bg : DSH_TOKENS.bgCard,
                    color: p.enabled ? TONE_STYLES.emerald.color : DSH_TOKENS.textPrimary,
                    cursor: 'pointer',
                  }}
                >
                  {p.enabled ? '使用中' : '启用'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Section 3: Session & Local Quota / Usage Telemetry */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: DSH_TOKENS.textSecondary }}>
            会话模型与调用统计
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              background: TONE_STYLES.indigo.bg,
              color: TONE_STYLES.indigo.color,
              border: `1px solid ${TONE_STYLES.indigo.border}`,
            }}
          >
            当前模型：{usage.currentModel}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div style={{ ...surfaceStyle, padding: '9px 11px' }}>
            <div style={{ fontSize: 11.5, color: DSH_TOKENS.textSecondary, fontWeight: 500 }}>
              当前会话步数 / 提问轮数
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                marginTop: 3,
                color: DSH_TOKENS.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {usage.convSteps} 步 / {usage.convUserTurns} 轮
            </div>
          </div>

          <div style={{ ...surfaceStyle, padding: '9px 11px' }}>
            <div style={{ fontSize: 11.5, color: DSH_TOKENS.textSecondary, fontWeight: 500 }}>
              今日总步数 / 生图调用
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                marginTop: 3,
                color: DSH_TOKENS.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {usage.todaySteps} 步 / {usage.todayImages} 图
            </div>
          </div>
        </div>

        <div style={{ marginTop: 6 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: DSH_TOKENS.textSecondary,
              fontWeight: 500,
              marginBottom: 5,
            }}
          >
            <span>
              当前对话上下文负载 (
              {usage.pressureTokens > 0
                ? `${formatTokens(usage.pressureTokens)} / ${formatTokens(usage.contextWindow)} tokens · ${usage.convContextKB} KB`
                : `${usage.convContextKB} KB`}
              )
            </span>
            <span style={{ color: DSH_TOKENS.textPrimary, fontWeight: 700 }}>{pct}%</span>
          </div>
          <div
            style={{
              width: '100%',
              height: 8,
              background: DSH_TOKENS.bgSurface,
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: barColor,
                borderRadius: 999,
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          {/* Time grounding indicator — visible in both compact and settings modes */}
          <div
            data-dsh-part="persona-hub-time-badge"
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: `1px solid ${DSH_TOKENS.borderSubtle}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              fontSize: 11,
              color: DSH_TOKENS.textSecondary,
            }}
          >
            <span>🕒 时间来源</span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 999,
                background: timeBadge.bg,
                color: timeBadge.color,
                border: `1px solid ${timeBadge.border}`,
              }}
            >
              {timeBadge.label}
            </span>
            <span>· {timeReport?.timeZone || '系统默认时区'}</span>
          </div>
        </div>
      </div>

      {/* Optional Advanced Settings & Live Prompt Preview (shown in Settings page) */}
      {showAdvancedConfig && settings && (
        <div style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: DSH_TOKENS.textSecondary }}>
              高级设置与系统提示词注入预览
            </span>
            <button
              type="button"
              onClick={() => setShowPromptPreview(v => !v)}
              style={{
                fontSize: 11.5,
                padding: '3px 9px',
                borderRadius: 6,
                border: `1px solid ${DSH_TOKENS.borderStrong}`,
                background: DSH_TOKENS.bgSurface,
                color: DSH_TOKENS.textPrimary,
                cursor: 'pointer',
              }}
            >
              {showPromptPreview ? '收起注入预览' : '查看实时注入 Prompt'}
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 12.5,
              color: DSH_TOKENS.textPrimary,
            }}
          >
            {/* Persona Management placeholder - Agent-driven */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  padding: '8px',
                  background: DSH_TOKENS.bgBase,
                  color: DSH_TOKENS.textSecondary,
                  borderRadius: 4,
                  textAlign: 'center',
                  lineHeight: 1.4,
                }}
              >
                人设管理、导入与移植建议直接通过 <strong style={{ color: "var(--dsw-alias-brand-primary)" }}>Agent 对话</strong> 指导完成。<br/>
                你可以随时向我提问：“如何添加新的人设？”或“帮我移植一个人设插件”。
              </div>
              <button
                type="button"
                onClick={() => showToast('删除操作请通过 Agent 命令进行')}
                style={{
                  fontSize: 12,
                  padding: '6px',
                  background: 'rgba(244, 63, 94, 0.1)',
                  color: '#f43f5e',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                删除人设 (通过 Agent 命令执行)
              </button>
            </div>
          </div>

          {/* Time grounding — self-sufficient, dsh-environment-context is optional */}
          <div
            data-dsh-part="persona-hub-time"
            style={{
              ...surfaceStyle,
              marginTop: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: DSH_TOKENS.textPrimary }}>
                🕒 时间注入
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: timeBadge.bg,
                  color: timeBadge.color,
                  border: `1px solid ${timeBadge.border}`,
                }}
              >
                {timeBadge.label}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 }}>
              {TIME_MODE_OPTIONS.map(option => {
                const active = timeMode === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    title={option.hint}
                    onClick={() => void handleTimeMode(option.mode)}
                    style={{
                      fontSize: 11.5,
                      fontWeight: active ? 700 : 500,
                      padding: '4px 6px',
                      borderRadius: 7,
                      border: `1px solid ${active ? DSH_TOKENS.brand : DSH_TOKENS.borderSubtle}`,
                      background: active ? DSH_TOKENS.brandSoft : DSH_TOKENS.bgCard,
                      color: DSH_TOKENS.textPrimary,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            <div style={{ fontSize: 11, color: DSH_TOKENS.textSecondary, lineHeight: 1.5 }}>
              环境上下文：{ENVIRONMENT_LABELS[timeReport?.environmentContext ?? 'unknown'] || '待确认'}
              {' · '}
              时区：{timeReport?.timeZone || '系统默认'}
              <br />
              {timeReport?.detail || '等待首次探测…'}
            </div>

            {timeReport?.injected && timeReport.text && (
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  borderRadius: 8,
                  background: DSH_TOKENS.bgCard,
                  color: DSH_TOKENS.textPrimary,
                  border: `1px solid ${DSH_TOKENS.borderSubtle}`,
                  fontSize: 11,
                  maxHeight: 140,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {timeReport.text}
              </pre>
            )}
          </div>

          {showPromptPreview && (
            <pre
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                background: DSH_TOKENS.bgSurface,
                color: DSH_TOKENS.textPrimary,
                border: `1px solid ${DSH_TOKENS.borderStrong}`,
                fontSize: 11.5,
                maxHeight: 280,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {statusData?.promptPreview || '（当前未激活任何专属人设，不注入额外角色规则）'}
            </pre>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#10b981',
            color: '#ffffff',
            padding: '7px 16px',
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 600,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  )
}
