import React, { useEffect, useState } from 'react'
import type { ImageMode, PersonaItem, PersonasSnapshot, TimeFallbackMode, UsageTelemetry } from '../index.ts'
import { personaLabel, postHubSwitch, postSessionPersona, useHubStatus } from './status.ts'

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
  sessionId?: string
  inputActions?: { captureInsertion(): unknown; insertText(text: string, anchor: unknown): boolean }
  compact?: boolean
  showAdvancedConfig?: boolean
}

export function HubPanel({
  sessionId,
  inputActions,
  compact = false,
  showAdvancedConfig = false,
}: HubPanelProps) {
  const { data: statusData, error: statusError, refresh } = useHubStatus(sessionId ?? null, true)
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const selectedImageMode = statusData?.settings.preferredImageMode ?? 'realistic'
  const syncLabel = saving ? '正在切换…' : statusError ? '重试' : statusData ? '实时同步中' : '同步中…'
  const canSwitch = Boolean(statusData) && !saving && (!sessionId || statusData?.sessionAvailable === true)

  useEffect(() => {
    if (!toastMsg) return
    const timer = setTimeout(() => setToastMsg(null), 2400)
    return () => clearTimeout(timer)
  }, [toastMsg])

  const showToast = setToastMsg
  const handleSwitchPersona = async (personaId: string | null) => {
    if (!canSwitch) return
    setSaving(true)
    try {
      const data = sessionId
        ? await postSessionPersona(sessionId, personaId)
        : await postHubSwitch({ enabled: personaId !== 'none', activePersona: personaId ?? 'none' })
      setSelectedPersonaId(null)
      if (personaId === null) showToast('本会话已恢复跟随默认人设')
      else if (personaId === 'none') showToast(sessionId ? '本会话已停用人设' : '已停用默认人设')
      else showToast(`${sessionId ? '本会话人设' : '默认人设'}：${personaLabel(data.personas.activePersonas[0])}`)
    } catch {
      showToast('切换失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const handleSwitchImageMode = async (mode: ImageMode) => {
    try {
      await postHubSwitch({ preferredImageMode: mode })
      showToast(
        mode === 'realistic'
          ? '已设为默认写实参考图模式 📸'
          : '已设为第二参考图 (二次元/九宫格) 模式 🎨',
      )
    } catch {
      showToast('参考图设置失败，请重试')
    }
  }

  const handleTimeMode = async (mode: TimeFallbackMode) => {
    try {
      await postHubSwitch({ timeFallback: mode })
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

  const handlePromptClick = async (promptText: string) => {
    try {
      if (inputActions?.captureInsertion && inputActions.insertText?.(promptText, inputActions.captureInsertion())) {
        void navigator.clipboard?.writeText(promptText).catch(() => {})
        showToast('已填入当前会话输入框 ✨')
        return
      }
      await navigator.clipboard.writeText(promptText)
      showToast('已复制提问到剪贴板 ✨')
    } catch {
      showToast('无法填入输入框或复制提问')
    }
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
  const timeReport = statusData?.time
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
          <span>{sessionId ? '✨ 当前会话人设' : '✨ 默认人设'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {sessionId && statusData && (
            statusData.sessionAvailable && statusData.sessionPersona !== null ? (
              <button type="button" disabled={!canSwitch} onClick={() => void handleSwitchPersona(null)}
                style={{ ...surfaceStyle, padding: '3px 8px', fontSize: 11 }}>
                跟随默认
              </button>
            ) : (
              <span style={{ color: DSH_TOKENS.textSecondary, fontSize: 11 }}>
                {statusData.sessionAvailable ? '跟随默认' : '此会话暂不支持绑定'}
              </span>
            )
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
                目前以 DSH 标准助手身份运行中。可以在下方「已安装人设图鉴」预览并启用人设。
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
