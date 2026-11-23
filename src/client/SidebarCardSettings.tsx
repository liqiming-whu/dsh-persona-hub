import React, { useEffect, useState } from 'react'
import { DSH_TOKENS } from './HubPanel.tsx'
import { postHubSwitch, useHubStatus } from './status.ts'

const MIN_WIDTH = 160
const MAX_WIDTH = 480
const DEFAULT_FIXED_WIDTH = 240
const inputStyle: React.CSSProperties = {
  border: `1px solid ${DSH_TOKENS.borderStrong}`,
  background: DSH_TOKENS.bgSurface,
  color: DSH_TOKENS.textPrimary,
  borderRadius: 7,
  padding: '4px 7px',
  font: 'inherit',
}

export function SidebarCardSettings() {
  const { data, error, refresh } = useHubStatus(null)
  const savedShow = data?.settings.showSidebarCard ?? true
  const savedWidth = data?.settings.sidebarCardWidth ?? 0
  const [show, setShow] = useState(savedShow)
  const [adaptive, setAdaptive] = useState(savedWidth === 0)
  const [width, setWidth] = useState(String(savedWidth || DEFAULT_FIXED_WIDTH))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setShow(savedShow)
    setAdaptive(savedWidth === 0)
    setWidth(String(savedWidth || DEFAULT_FIXED_WIDTH))
  }, [savedShow, savedWidth])

  const widthPx = Number(width)
  const validWidth = adaptive || (Number.isInteger(widthPx) && widthPx >= MIN_WIDTH && widthPx <= MAX_WIDTH)
  const nextWidth = adaptive ? 0 : widthPx
  const dirty = show !== savedShow || nextWidth !== savedWidth
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!data || !validWidth || !dirty || saving) return
    setSaving(true)
    setNotice('')
    try {
      await postHubSwitch({ showSidebarCard: show, sidebarCardWidth: nextWidth })
      setNotice('已保存')
    } catch {
      setNotice('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={save}
      data-dsh-part="sidebar-card-settings"
      style={{
        display: 'grid', gap: 10, padding: 14, marginBottom: 16,
        background: DSH_TOKENS.bgCard, border: `1px solid ${DSH_TOKENS.borderStrong}`,
        borderRadius: 14, fontSize: 13,
      }}
    >
      <strong style={{ fontSize: 14 }}>左侧栏角色卡片</strong>
      {!data ? (
        error ? <button type="button" onClick={() => void refresh()} style={inputStyle}>读取失败，点击重试</button>
          : <span role="status" style={{ color: DSH_TOKENS.textSecondary }}>正在读取设置…</span>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: 'fit-content' }}>
            <input type="checkbox" checked={show} disabled={saving} onChange={e => { setShow(e.target.checked); setNotice('') }} />
            显示左侧栏角色卡片
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              卡片宽度
              <select
                aria-label="卡片宽度"
                value={adaptive ? 'auto' : 'fixed'}
                disabled={saving}
                onChange={e => { setAdaptive(e.target.value === 'auto'); setNotice('') }}
                style={inputStyle}
              >
                <option value="auto">自适应（跟随侧栏）</option>
                <option value="fixed">固定宽度</option>
              </select>
            </label>
            {!adaptive && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min={MIN_WIDTH}
                  max={MAX_WIDTH}
                  step={1}
                  required
                  disabled={saving}
                  value={width}
                  onChange={e => { setWidth(e.target.value); setNotice('') }}
                  aria-label="固定卡片宽度（像素）"
                  style={{ ...inputStyle, width: 76 }}
                /> px
              </label>
            )}
          </div>
          <span style={{ fontSize: 12, color: DSH_TOKENS.textSecondary }}>
            固定宽度可设为 {MIN_WIDTH}–{MAX_WIDTH} px，侧栏较窄时自动缩小。不影响会话顶栏入口。
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="submit"
              disabled={!validWidth || !dirty || saving}
              style={{ ...inputStyle, fontWeight: 600, cursor: dirty && validWidth && !saving ? 'pointer' : 'default' }}
            >保存卡片设置</button>
            <span role="status" style={{ color: DSH_TOKENS.textSecondary }}>{saving ? '保存中…' : notice}</span>
          </div>
        </>
      )}
    </form>
  )
}
