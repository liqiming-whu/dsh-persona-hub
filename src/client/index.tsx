import React, { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PersonaHubSettings } from '../index.ts'
import {
  DSH_TOKENS,
  fetchHubStatus,
  getSharedState,
  HubPanel,
  postHubSwitch,
  subscribeSharedState,
  updateSharedState,
} from './HubPanel.tsx'

export const PERSONA_HUB_TAB_ID = 'dsh-persona-hub'
export const PERSONA_HUB_TAB_KIND = 'persona-hub'
export const PERSONA_HUB_GUIDE_ENTRY_ID = 'open'

/**
 * Icon shown in the Right Sidebar's "开始" (Guide) list and in the tab chip.
 */
function PersonaHubGuideGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ color: '#6366f1', flexShrink: 0 }}
    >
      <rect
        x="2"
        y="2.5"
        width="14"
        height="13"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5.2 6.8L6.8 4.6L8.2 6.6M12.8 6.8L11.2 4.6L9.8 6.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.8" cy="9.6" r="1" fill="currentColor" />
      <circle cx="11.2" cy="9.6" r="1" fill="currentColor" />
      <path
        d="M7.5 12.1C8.3 12.7 9.7 12.7 10.5 12.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PersonaHubTabMark() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ color: 'currentColor', flexShrink: 0 }}
    >
      <rect
        x="2"
        y="2.5"
        width="14"
        height="13"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="6.8" cy="9.5" r="1" fill="currentColor" />
      <circle cx="11.2" cy="9.5" r="1" fill="currentColor" />
      <path
        d="M7.5 12C8.3 12.6 9.7 12.6 10.5 12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Open the Persona Hub tab inside DSH's native Right Sidebar (`rightbar`),
 * or navigate to Settings if no session rightbar is active.
 */
function openInNativeRightSidebar(ctx: Context): void {
  try {
    const anyCtx = ctx as any
    const sr = anyCtx.get?.('sidebarRight', false) ?? anyCtx.sidebarRight
    if (sr) {
      if (typeof sr.openTab === 'function') {
        sr.openTab(PERSONA_HUB_TAB_KIND, {})
        return
      }
      const sessionId = getSharedState().activeSessionId
      if (sessionId && typeof sr.openTabIn === 'function') {
        sr.openTabIn(sessionId, PERSONA_HUB_TAB_KIND, {})
        return
      }
    }
  } catch {
    // Fall through to DOM guide button click
  }

  // If the Right Sidebar "开始" (Guide) list is currently rendered in DOM, click our guide capsule
  if (typeof document !== 'undefined') {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
    for (const btn of buttons) {
      if (btn.textContent && btn.textContent.includes('人设控制台')) {
        ;(btn as HTMLElement).click()
        return
      }
    }
  }
}

function SettingsSection({ scope }: { scope: ConfigForm<PersonaHubSettings> }) {
  return (
    <section style={{ maxWidth: 780, padding: '4px 0 24px', color: DSH_TOKENS.textPrimary }}>
      <HubPanel scope={scope} compact={false} showAdvancedConfig={true} />
    </section>
  )
}

/**
 * Left Sidebar Compact Active Persona Card (mounted in `sidebar.footer.action`)
 * Supports both expanded sidebar (`wide !== false`) and collapsed 56px rail (`wide === false`).
 */
function LeftSidebarPersonaCard(props: any) {
  const { scope, ctx, wide = true } = props
  const [status, setStatus] = useState(() => getSharedState().latestStatus)

  useEffect(() => {
    if (!getSharedState().latestStatus) {
      void fetchHubStatus(getSharedState().activeSessionId)
    }
    return subscribeSharedState(() => {
      setStatus(getSharedState().latestStatus)
    })
  }, [])

  const personas = status?.personas
  const activePersona = personas?.activePersonas?.[0] || null
  const allPersonas = personas?.allPersonas || []
  const shortName = activePersona ? activePersona.displayName.split(' ')[0] : '未启用人设'

  const handleQuickSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const nextId = activePersona?.id === id ? 'none' : id
    void postHubSwitch(
      {
        enabled: nextId !== 'none',
        activePersona: nextId,
      },
      scope,
    )
  }

  // Collapsed 56px sidebar rail mode
  if (wide === false) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '4px 0',
        }}
      >
        <button
          type="button"
          onClick={() => openInNativeRightSidebar(ctx)}
          title={`当前角色：${shortName}（点击在右侧边栏打开人设控制台）`}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            padding: 0,
            border: `1.5px solid ${activePersona ? DSH_TOKENS.brand : DSH_TOKENS.borderStrong}`,
            background: DSH_TOKENS.bgCard,
            color: DSH_TOKENS.textPrimary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {activePersona?.logoUrl ? (
            <img
              src={activePersona.logoUrl}
              alt={shortName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 15 }}>✨</span>
          )}
        </button>
      </div>
    )
  }

  // Expanded left sidebar card
  return (
    <div
      style={{
        background: DSH_TOKENS.bgCard,
        border: `1px solid ${DSH_TOKENS.borderStrong}`,
        borderRadius: 10,
        padding: '8px 10px',
        margin: '4px 0',
        color: DSH_TOKENS.textPrimary,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
      }}
    >
      {/* Top Row: Active Persona Avatar + Name + Open Right Sidebar Button */}
      <div
        onClick={() => openInNativeRightSidebar(ctx)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
        }}
        title="点击在右侧边栏打开人设控制台"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {activePersona?.logoUrl ? (
            <img
              src={activePersona.logoUrl}
              alt={shortName}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                objectFit: 'cover',
                border: `1.5px solid ${DSH_TOKENS.brand}`,
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: DSH_TOKENS.bgSurface,
                border: `1px solid ${DSH_TOKENS.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              ✨
            </div>
          )}

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontWeight: 700,
                fontSize: 12.5,
                color: DSH_TOKENS.textPrimary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: activePersona ? '#10b981' : '#94a3b8',
                  flexShrink: 0,
                }}
              />
              <span>{shortName}</span>
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: DSH_TOKENS.textSecondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activePersona
                ? activePersona.id === 'hajimi-persona'
                  ? '猫娘拍档在线喵~'
                  : activePersona.id === 'xiaoke-persona'
                    ? '大小姐拍档在线'
                    : activePersona.id === 'xiaojingyu-persona'
                      ? '深海鲸鱼娘拍档在线'
                      : activePersona.id === 'linzhiwei-persona'
                        ? 'Ada 恋人搭档在线'
                        : '专属人设已激活'
                : '标准助手模式'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            openInNativeRightSidebar(ctx)
          }}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 7px',
            borderRadius: 6,
            border: `1px solid ${DSH_TOKENS.borderStrong}`,
            background: DSH_TOKENS.bgSurface,
            color: DSH_TOKENS.textPrimary,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          右栏 ▸
        </button>
      </div>

      {/* Bottom Row: 1-Click Quick Persona Switcher Pills (at most 4 tabs) */}
      {allPersonas.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(allPersonas.length, 4)}, minmax(0, 1fr))`,
            gap: 4,
          }}
        >
          {allPersonas.slice(0, 4).map(p => {
            const pShort = p.displayName.split(' ')[0]
            return (
              <button
                key={p.id}
                type="button"
                onClick={e => handleQuickSelect(p.id, e)}
                title={p.enabled ? `点击停用 ${pShort}` : `点击直接切换到 ${pShort}`}
                style={{
                  fontSize: 10.5,
                  fontWeight: p.enabled ? 700 : 500,
                  padding: '3px 2px',
                  borderRadius: 6,
                  border: p.enabled
                    ? '1px solid rgba(16, 185, 129, 0.45)'
                    : `1px solid ${DSH_TOKENS.borderSubtle}`,
                  background: p.enabled
                    ? 'color-mix(in srgb, #10b981 18%, transparent)'
                    : DSH_TOKENS.bgSurface,
                  color: p.enabled
                    ? 'color-mix(in srgb, #10b981 65%, var(--dsw-alias-label-primary, #d1fae5))'
                    : DSH_TOKENS.textSecondary,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textAlign: 'center',
                }}
              >
                {p.enabled ? `● ${pShort}` : pShort}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Native Right Sidebar Tab Body (`sidebar.right.pane.tab`)
 */
function RightSidebarTabBody(props: any) {
  const { scope, sessionId, inputActions } = props

  useEffect(() => {
    if (sessionId || inputActions) {
      updateSharedState({
        activeSessionId: sessionId || getSharedState().activeSessionId,
        inputActions: inputActions || getSharedState().inputActions,
      })
    }
  }, [sessionId, inputActions])

  return (
    <div
      data-dsh-plugin="persona-hub"
      style={{
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        padding: '12px 14px 20px',
        color: DSH_TOKENS.textPrimary,
        boxSizing: 'border-box',
      }}
    >
      <HubPanel scope={scope} compact={true} showAdvancedConfig={false} />
    </div>
  )
}

/**
 * Native Right Sidebar Tab Chip Title (`sidebar.right.pane.tab.title`)
 */
function RightSidebarTabTitle() {
  const [status, setStatus] = useState(() => getSharedState().latestStatus)

  useEffect(() => {
    return subscribeSharedState(() => {
      setStatus(getSharedState().latestStatus)
    })
  }, [])

  const activePersona = status?.personas?.activePersonas?.[0] || null
  const label = activePersona
    ? `人设 · ${activePersona.displayName.split(' ')[0]}`
    : '人设控制台'

  return (
    <span
      data-dsh-plugin="persona-hub"
      data-dsh-part="tab-title"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: DSH_TOKENS.textPrimary,
      }}
    >
      <PersonaHubTabMark />
      <span>{label}</span>
    </span>
  )
}

export const inject = ['slots', 'sidebarRightTabs', 'configForms']

export function apply(ctx: Context): void {
  const scope = ctx.configForms.get<PersonaHubSettings>('persona-hub')

  // Clean up any leftover push-style tag from v1.1.0
  if (typeof document !== 'undefined') {
    document.getElementById('dsh-persona-hub-dock-push-style')?.remove()
  }

  // 1. Stage One: Register the static Tab Type & Guide ("开始" list) entry in DSH's native Right Sidebar
  ctx.effect(() => {
    try {
      return (ctx as any).sidebarRightTabs.register({
        id: PERSONA_HUB_TAB_ID,
        kind: PERSONA_HUB_TAB_KIND,
        keepMounted: true,
        priority: 'extension',
        title: () => '人设控制台',
        guide: [
          {
            id: PERSONA_HUB_GUIDE_ENTRY_ID,
            order: 45,
            title: () => '人设控制台',
            description: () => '切换哈基米、小克、小鲸鱼等人设，预览双形象与会话负载，并管理外部人设包',
            icon: PersonaHubGuideGlyph,
          },
        ],
      })
    } catch {
      return () => {}
    }
  }, 'persona-hub: tab type')

  // 2. Stage Two: Register the Right Sidebar Tab Body & Tab Title under the same PERSONA_HUB_TAB_ID
  ctx.effect(() =>
    ctx.slots.inject('sidebar.right.pane.tab', () => {
      try {
        return ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: PERSONA_HUB_TAB_ID,
            inject: (sessionId: any) => ({ scope, sessionId }),
          } as any,
          RightSidebarTabBody,
        )
      } catch {
        return () => {}
      }
    }),
  )

  ctx.effect(() =>
    ctx.slots.inject('sidebar.right.pane.tab.title', () => {
      try {
        return ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab.title',
            key: PERSONA_HUB_TAB_ID,
            inject: (sessionId: any) => ({ scope, sessionId }),
          } as any,
          RightSidebarTabTitle,
        )
      } catch {
        return () => {}
      }
    }),
  )

  // 3. Register Compact Active Persona Card in Left Sidebar (`sidebar.footer.action`)
  ctx.effect(() =>
    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: 'persona-hub-sidebar-card',
          order: -5,
          label: () => '当前启用角色',
          inject: () => ({ scope, ctx }),
        },
        LeftSidebarPersonaCard,
      ),
    ),
  )

  // 4. Register in Settings page
  ctx.effect(() =>
    ctx.configForms.whileServed(['persona-hub'], () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'persona-hub',
            order: 34,
            label: () => '人设控制台',
            inject: () => ({ scope }),
          },
          SettingsSection,
        ),
      ),
    ),
  )
}
