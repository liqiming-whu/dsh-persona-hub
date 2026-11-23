import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import { DSH_TOKENS } from './HubPanel.tsx'
import { personaLabel, postSessionPersona, useHubStatus } from './status.ts'

const ellipsis: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const quietButton: React.CSSProperties = {
  background: DSH_TOKENS.bgSurface,
  border: `1px solid ${DSH_TOKENS.borderStrong}`,
  color: DSH_TOKENS.textPrimary,
  borderRadius: 8,
  padding: '4px 8px',
  font: 'inherit',
  cursor: 'pointer',
}

export function SessionPersonaControl({ sessionId, openDetails }: {
  sessionId: string
  openDetails?: () => void
}) {
  const { data, error, refresh } = useHubStatus(sessionId)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const active = data?.personas.activePersonas[0]
  const label = data && data.sessionAvailable ? personaLabel(active) : '人设'
  const available = data?.sessionAvailable === true
  const hasPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype

  // The native top layer escapes DSH's clipped header and provides light-dismiss / Escape.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const trigger = triggerRef.current
    const close = closeRef.current
    if (!panel || !trigger || !close) return
    // Set native attributes directly so this also works with React 18's older DOM types.
    trigger.setAttribute('popovertarget', panel.id)
    close.setAttribute('popovertarget', panel.id)
    close.setAttribute('popovertargetaction', 'hide')
    close.setAttribute('autofocus', '')
    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const viewport = document.documentElement.clientWidth
      const width = Math.min(344, Math.max(0, viewport - 20))
      const left = Math.max(10, Math.min(rect.left, viewport - width - 10))
      const top = rect.bottom + 8
      Object.assign(panel.style, {
        width: `${width}px`, left: `${left}px`, top: `${top}px`,
        maxHeight: `min(480px, calc(100dvh - ${top + 10}px))`,
      })
    }
    const beforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'open') position()
    }
    const handleResize = () => { if (panel.matches(':popover-open')) position() }
    panel.addEventListener('beforetoggle', beforeToggle)
    window.addEventListener('resize', handleResize)
    const header = trigger.closest('header')
    const resize = new ResizeObserver(handleResize)
    if (header) resize.observe(header)
    resize.observe(trigger)
    return () => {
      panel.removeEventListener('beforetoggle', beforeToggle)
      window.removeEventListener('resize', handleResize)
      resize.disconnect()
    }
  }, [])

  const choose = async (personaId: string | null) => {
    if (!available || saving || data?.sessionPersona === personaId) return
    setSaving(true)
    setNotice('')
    try {
      await postSessionPersona(sessionId, personaId)
      setNotice('已保存到当前会话')
    } catch {
      setNotice('保存失败，请重试')
      void refresh()
    } finally {
      setSaving(false)
    }
  }

  const optionStyle = (isPicked: boolean): React.CSSProperties => ({
    ...quietButton,
    width: '100%',
    minWidth: 0,
    padding: '6px 8px',
    minHeight: 34,
    textAlign: 'left',
    cursor: available && !saving ? 'pointer' : 'default',
    borderColor: isPicked ? DSH_TOKENS.brand : DSH_TOKENS.borderSubtle,
    background: isPicked ? DSH_TOKENS.brandSoft : DSH_TOKENS.bgCard,
    fontWeight: isPicked ? 650 : 500,
  })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-dsh-part="session-persona-button"
        title={`当前会话人设：${label}`}
        aria-haspopup={hasPopover ? 'dialog' : undefined}
        aria-controls={hasPopover ? id : undefined}
        onClick={hasPopover ? undefined : openDetails}
        disabled={!hasPopover && !openDetails}
        style={{
          ...quietButton,
          background: DSH_TOKENS.bgCard,
          display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
          borderRadius: 8, height: 26, maxWidth: 140, padding: '0 8px', fontSize: 12,
        }}
      >
        {active?.logoUrl && available && (
          <img src={active.logoUrl} alt="" width={15} height={15} style={{ borderRadius: 4, objectFit: 'cover' }} />
        )}
        <span style={ellipsis}>{label}</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0 }}>
          <path d="m2.3 3.7 2.7 2.7 2.7-2.7" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {hasPopover && (
        <div
          ref={panelRef}
          id={id}
          {...{ popover: 'auto' }}
          role="dialog"
          aria-labelledby={`${id}-title`}
          data-dsh-part="session-persona-popover"
          style={{
            boxSizing: 'border-box', position: 'fixed', inset: 'auto', margin: 0,
            background: DSH_TOKENS.bgBase, color: DSH_TOKENS.textPrimary,
            border: `1px solid ${DSH_TOKENS.borderStrong}`, borderRadius: 12,
            padding: 12, boxShadow: '0 10px 32px rgb(0 0 0 / 24%)',
            lineHeight: 1.45, fontSize: 12, overflow: 'auto', overscrollBehavior: 'contain',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong id={`${id}-title`} style={{ fontSize: 14 }}>当前会话人设</strong>
            <button
              ref={closeRef}
              type="button"
              aria-label="关闭人设面板"
              style={{ ...quietButton, padding: '1px 7px' }}
            >×</button>
          </div>
          <p style={{ margin: '5px 0 10px', color: DSH_TOKENS.textSecondary }}>
            只影响此会话的后续回复，不会改动默认人设。
          </p>
          {available && data ? (
            <>
              <div aria-label="人设选项" role="group" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                {data.personas.allPersonas.map(persona => {
                  const picked = data.sessionPersona === persona.id
                  return (
                    <button
                      key={persona.id}
                      type="button"
                      aria-pressed={picked}
                      disabled={saving}
                      title={persona.displayName}
                      onClick={() => void choose(persona.id)}
                      style={{ ...optionStyle(picked), display: 'flex', alignItems: 'center', gap: 7 }}
                    >
                      {persona.logoUrl && <img src={persona.logoUrl} alt="" width={20} height={20} style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />}
                      <span style={ellipsis}>{personaLabel(persona)}</span>
                      {picked && <span aria-hidden="true" style={{ marginLeft: 'auto', color: DSH_TOKENS.brand }}>✓</span>}
                    </button>
                  )
                })}
                <button
                  type="button"
                  aria-pressed={data.sessionPersona === null}
                  disabled={saving}
                  onClick={() => void choose(null)}
                  style={optionStyle(data.sessionPersona === null)}
                >跟随默认</button>
                <button
                  type="button"
                  aria-pressed={data.sessionPersona === 'none'}
                  disabled={saving}
                  onClick={() => void choose('none')}
                  style={optionStyle(data.sessionPersona === 'none')}
                >不用人设</button>
              </div>
              {data.sessionPersona && data.sessionPersona !== 'none' && !active && (
                <p style={{ margin: '6px 0', color: DSH_TOKENS.textSecondary }}>已绑定的人设不可用，请重新选择。</p>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <span role="status" style={{ color: DSH_TOKENS.textSecondary }}>{saving ? '保存中…' : notice}</span>
                {openDetails && <button
                  type="button"
                  onClick={() => { panelRef.current?.hidePopover(); openDetails() }}
                  style={quietButton}
                >在右侧栏查看详情</button>}
              </div>
            </>
          ) : (
            <div role="status" style={{ color: DSH_TOKENS.textSecondary }}>
              {error ? <button type="button" style={quietButton} onClick={() => void refresh()}>读取失败，点击重试</button>
                : data ? '此会话暂不支持绑定人设。' : '正在读取人设…'}
            </div>
          )}
        </div>
      )}
    </>
  )
}
