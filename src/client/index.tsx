import React, { useCallback, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DSH_TOKENS, HubPanel, type HubPanelProps } from './HubPanel.tsx'
import { SessionPersonaControl } from './SessionPersonaControl.tsx'
import { SidebarCardSettings } from './SidebarCardSettings.tsx'
import { personaLabel, postHubSwitch, postSessionPersona, useHubStatus } from './status.ts'

export const PERSONA_HUB_TAB_ID = 'dsh-persona-hub'
export const PERSONA_HUB_TAB_KIND = 'persona-hub'
export const PERSONA_HUB_GUIDE_ENTRY_ID = 'open'

function PersonaHubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="2" y="2.5" width="14" height="13" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 6.8L6.8 4.6L8.2 6.6M12.8 6.8L11.2 4.6L9.8 6.6M7.5 12.1C8.3 12.7 9.7 12.7 10.5 12.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.8" cy="9.6" r="1" fill="currentColor" />
      <circle cx="11.2" cy="9.6" r="1" fill="currentColor" />
    </svg>
  )
}

// Public sidebarRight contract on DSH rc.5. Keep the narrow projection here
// since the repo's renderer typings predate this service declaration.
interface SidebarRight {
  mounted?: { getSnapshot(): string | undefined; subscribe(listener: () => void): () => void }
  openTab(kind: string): void
}

const smallButton: React.CSSProperties = {
  color: DSH_TOKENS.textPrimary,
  background: DSH_TOKENS.bgSurface,
  border: `1px solid ${DSH_TOKENS.borderStrong}`,
  borderRadius: 6,
  cursor: 'pointer',
  font: 'inherit',
}
const singleLine: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }

function SettingsSection() {
  return (
    <section style={{ maxWidth: 760, padding: '4px 0 24px', color: DSH_TOKENS.textPrimary }}>
      <SidebarCardSettings />
      <HubPanel showAdvancedConfig />
    </section>
  )
}

function LeftSidebarPersonaCard({ wide, rightbar }: { wide: boolean; rightbar?: SidebarRight }) {
  const mounted = rightbar?.mounted
  const sessionId = useSyncExternalStore(
    useCallback(notify => mounted?.subscribe(notify) ?? (() => {}), [mounted]),
    useCallback(() => mounted?.getSnapshot() ?? null, [mounted]),
  )
  const openDetails = sessionId && rightbar ? () => {
    if (mounted?.getSnapshot() === sessionId) rightbar.openTab(PERSONA_HUB_TAB_KIND)
  } : undefined
  return <SidebarCard key={sessionId ?? 'default'} sessionId={sessionId} wide={wide} openDetails={openDetails} />
}

function SidebarCard({ sessionId, wide, openDetails }: { sessionId: string | null; wide: boolean; openDetails?: () => void }) {
  const { data: status } = useHubStatus(sessionId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  if (!status || status.settings.showSidebarCard === false) return null

  const isAvailable = sessionId === null || status.sessionAvailable
  const active = isAvailable ? status.personas.activePersonas[0] : undefined
  const names = isAvailable ? status.personas.allPersonas.slice(0, 4) : []
  const shortName = isAvailable ? personaLabel(active) : '人设不可用'
  const width = status.settings.sidebarCardWidth ?? 0
  const switchTo = async (id: string) => {
    if (saving || !isAvailable) return
    setError(false)
    setSaving(true)
    try {
      const nextId = active?.id === id ? 'none' : id
      if (sessionId) await postSessionPersona(sessionId, nextId)
      else await postHubSwitch({ enabled: nextId !== 'none', activePersona: nextId })
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const avatar = (size: number) => active?.logoUrl ? (
    <img src={active.logoUrl} alt="" width={size} height={size} style={{ borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />
  ) : <PersonaHubGlyph />

  if (!wide) {
    return (
      <div data-dsh-part="left-persona-card" style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        {openDetails ? (
          <button
            type="button"
            onClick={openDetails}
            title={`当前角色：${shortName}（在右侧栏打开人设控制台）`}
            style={{ ...smallButton, display: 'grid', placeItems: 'center', boxSizing: 'border-box', width: 34, height: 34, padding: 2, borderRadius: 10 }}
          >{avatar(28)}</button>
        ) : <span title={shortName}>{avatar(28)}</span>}
      </div>
    )
  }

  return (
    <div
      data-dsh-part="left-persona-card"
      style={{
        width: width === 0 ? '100%' : width, maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
        background: DSH_TOKENS.bgCard, border: `1px solid ${DSH_TOKENS.borderStrong}`, borderRadius: 10,
        padding: '8px 10px', margin: '4px 0', color: DSH_TOKENS.textPrimary, fontSize: 12,
        display: 'flex', flexDirection: 'column', gap: 7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {avatar(30)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={active?.displayName ?? shortName} style={{ ...singleLine, fontWeight: 700 }}>{shortName}</div>
          <div style={{ ...singleLine, fontSize: 10.5, color: DSH_TOKENS.textSecondary }}>
            {sessionId === null ? '默认人设' : !isAvailable ? '此会话暂不支持绑定'
              : status.sessionPersona === null ? '当前会话 · 跟随默认' : '当前会话 · 独立绑定'}
          </div>
        </div>
        {openDetails && <button type="button" onClick={openDetails} title="在右侧栏打开人设控制台"
          style={{ ...smallButton, padding: '3px 6px', fontWeight: 600, flexShrink: 0 }}>右栏 ▸</button>}
      </div>
      {!!names.length && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 46px), 1fr))', gap: 4 }}>
          {names.map(p => (
            <button
              key={p.id}
              type="button"
              title={`${sessionId ? '仅当前会话' : '设置默认人设'}：${p.enabled ? '停用' : '切换到'} ${personaLabel(p)}`}
              onClick={() => void switchTo(p.id)}
              aria-pressed={p.enabled}
              disabled={saving}
              style={{
                ...smallButton, ...singleLine, padding: '3px 2px', fontSize: 10.5,
                borderColor: p.enabled ? DSH_TOKENS.brand : DSH_TOKENS.borderSubtle,
                background: p.enabled ? DSH_TOKENS.brandSoft : DSH_TOKENS.bgSurface,
                fontWeight: p.enabled ? 700 : 500,
              }}
            >{personaLabel(p)}</button>
          ))}
        </div>
      )}
      {error && <span role="alert" style={{ color: DSH_TOKENS.textSecondary }}>切换失败，请重试</span>}
    </div>
  )
}

function RightSidebarTabBody({ sessionId, inputActions }: { sessionId: string; inputActions?: HubPanelProps['inputActions'] }) {
  return (
    <div data-dsh-plugin="persona-hub" style={{
      height: '100%', width: '100%', overflowY: 'auto', padding: '12px 14px 20px',
      color: DSH_TOKENS.textPrimary, boxSizing: 'border-box',
    }}>
      <HubPanel key={sessionId} sessionId={sessionId} inputActions={inputActions} compact />
    </div>
  )
}

function RightSidebarTabTitle({ sessionId }: { sessionId: string }) {
  const { data } = useHubStatus(sessionId)
  const active = data?.sessionAvailable ? data.personas.activePersonas[0] : undefined
  return (
    <span data-dsh-plugin="persona-hub" data-dsh-part="tab-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: DSH_TOKENS.textPrimary }}>
      <PersonaHubGlyph />
      <span>{active ? `人设 · ${personaLabel(active)}` : '人设控制台'}</span>
    </span>
  )
}

export const inject = ['slots', 'sidebarRightTabs', 'configForms']

export function apply(ctx: Context): void {
  // sidebarRight is optional; the header and saved choices don't depend on it.
  ctx.effect(() => (ctx as any).sidebarRightTabs.register({
    id: PERSONA_HUB_TAB_ID,
    kind: PERSONA_HUB_TAB_KIND,
    keepMounted: true,
    priority: 'extension',
    title: () => '人设控制台',
    guide: [{
      id: PERSONA_HUB_GUIDE_ENTRY_ID,
      order: 45,
      title: () => '人设控制台',
      description: () => '切换当前会话的人设，预览双形象与会话负载',
      icon: PersonaHubGlyph,
    }],
  }), 'persona-hub: tab type')

  const rightbar = () => (ctx as any).get('sidebarRight') as SidebarRight | undefined
  function HeaderAction({ sessionId }: { sessionId: string }) {
    const detail = rightbar()
    const openDetails = detail && (() => {
      if (!detail.mounted || detail.mounted.getSnapshot() === sessionId) detail.openTab(PERSONA_HUB_TAB_KIND)
    })
    return <SessionPersonaControl key={sessionId} sessionId={sessionId} openDetails={openDetails} />
  }
  function SidebarFooter(props: { wide: boolean }) {
    return <LeftSidebarPersonaCard wide={props.wide} rightbar={rightbar()} />
  }

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'persona-hub-session-persona', order: -5,
  }, HeaderAction))

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PERSONA_HUB_TAB_ID,
  } as any, RightSidebarTabBody))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: PERSONA_HUB_TAB_ID,
  } as any, RightSidebarTabTitle))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'persona-hub-sidebar-card', order: -5,
    label: () => '当前启用角色',
  }, SidebarFooter))

  ctx.effect(() =>
    ctx.configForms.whileServed(['persona-hub'], () =>
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'persona-hub', order: 34, label: () => '人设控制台',
      }, SettingsSection)),
    ),
  )
}
