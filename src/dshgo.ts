import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { registerPersonaState } from './host-state.ts'
import { discoverPersonas, resolvePackageRoot, type PersonaHubSettings, type PersonaItem } from './personas.ts'

const IMAGE_OK = /\.(?:png|jpe?g|webp|gif)$/i
/** The bridge serves at most 1 MiB per asset file; anything larger shows as a broken image. */
const ASSET_LIMIT = 1000 * 1000
const LOGO_NAME = /^logo\.(?:png|jpe?g|jpeg|webp)$/i

type PanelScope = { sessionId?: string }

interface DshGoService {
  strip(id: string, def: (scope: PanelScope, emit: (value: unknown) => void, caps: unknown) => (() => void) | void): unknown
  panel(id: string, def: {
    view: (scope: PanelScope) => unknown
    data?: (scope: PanelScope, emit: (value: unknown) => void) => (() => void) | void
    actions?: Record<string, (scope: PanelScope, event: { value?: { value?: unknown } }) => unknown>
  }): unknown
}

interface ConfigEditor {
  entries(): readonly object[]
  canWrite?(entry: object): boolean
  edit(entry: object, change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}

function dshGoOf(ctx: Context): DshGoService | undefined {
  return (ctx as unknown as { dshGo?: DshGoService }).dshGo
}

function shortName(displayName: string, fallback: string, max = 12): string {
  const head = displayName.split(/[（(]/)[0].trim()
  const text = head !== '' ? head : fallback
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** App 只认 asset:<plugins assets 目录内的相对路径>；外部人设的图先复制进包目录。 */
function logoRef(persona: PersonaItem): string | null {
  try {
    if (!existsSync(persona.assetsDir)) return null
    const files = readdirSync(persona.assetsDir).filter(file => IMAGE_OK.test(file))
    const logo = files.find(file => LOGO_NAME.test(file)) ?? files.find(file => !/^logo\.svg$/i.test(file))
    if (!logo) return null
    const packageRoot = resolvePackageRoot()
    const builtinRoot = join(packageRoot, 'assets')
    const inside = persona.assetsDir.startsWith(`${builtinRoot}/`) || persona.assetsDir === builtinRoot
    if (inside && persona.source === 'builtin') {
      const relative = persona.assetsDir.slice(builtinRoot.length + 1)
      return `asset:${relative}/${logo}`
    }
    const ext = extname(logo).toLowerCase()
    const userDir = join(builtinRoot, 'user-logos')
    const target = join(userDir, `${persona.id}${ext}`)
    const needCopy = !existsSync(target) || statSync(target).mtimeMs < statSync(join(persona.assetsDir, logo)).mtimeMs
    if (needCopy) {
      mkdirSync(userDir, { recursive: true })
      copyFileSync(join(persona.assetsDir, logo), target)
    }
    return `asset:user-logos/${persona.id}${ext}`
  } catch {
    return null
  }
}

/** 预览图按「人设 + 形象模式」落成独立文件：路径跟着切换变化，App 才会真的换图。 */
function previewRef(persona: PersonaItem, mode: PersonaHubSettings['preferredImageMode']): string | null {
  const file = mode === 'secondary' ? persona.secondaryPath : persona.realisticPath
  if (!file || !existsSync(file)) return null
  try {
    const packageRoot = resolvePackageRoot()
    const builtinRoot = join(packageRoot, 'assets')
    const previewDir = join(builtinRoot, 'previews')
    const target = join(previewDir, `${persona.id}-${mode}.jpg`)
    const source = statSync(file)

    // 1. 优先用压缩过的预览图（App 的 assets 路由单个文件上限 1 MiB）。
    const stale = !existsSync(target) || source.mtimeMs > statSync(target).mtimeMs + 1000
    if (stale) {
      mkdirSync(previewDir, { recursive: true })
      try {
        execFileSync('convert', [file, '-resize', '900x900>', '-quality', '82', '-strip', target], { timeout: 20000, stdio: 'ignore' })
      } catch {
        // 没有 ImageMagick 或压缩失败，继续走回退路径。
      }
    }
    if (existsSync(target) && statSync(target).size <= ASSET_LIMIT) return `asset:previews/${persona.id}-${mode}.jpg`

    // 2. 原图本身够小就直接引用。
    const ext = extname(file).toLowerCase()
    if (source.size <= ASSET_LIMIT && IMAGE_OK.test(ext)) {
      if (persona.source === 'builtin' && file.startsWith(`${builtinRoot}/`)) return `asset:${file.slice(builtinRoot.length + 1)}`
      const copied = join(previewDir, `${persona.id}-${mode}${ext}`)
      if (!existsSync(copied) || statSync(copied).size !== source.size) {
        mkdirSync(previewDir, { recursive: true })
        copyFileSync(file, copied)
      }
      return `asset:previews/${persona.id}-${mode}${ext}`
    }
    return null
  } catch {
    return null
  }
}

export function registerDshGo(
  ctx: Context,
  readSettings: () => PersonaHubSettings,
  { personaFor, setSessionPersona }: ReturnType<typeof registerPersonaState>,
): void {
  ctx.inject(['dshGo'], child => {
    const dshGo = dshGoOf(child)
    if (!dshGo) return

    const ownEntry = ctx.fiber.entry as object | undefined
    const editor = ctx.get('configEditor') as ConfigEditor | undefined

    function writable(): boolean {
      if (!editor || !ownEntry) return false
      try {
        return typeof editor.canWrite === 'function' ? editor.canWrite(ownEntry) === true : true
      } catch {
        return false
      }
    }

    async function patchSettings(patch: Partial<PersonaHubSettings>): Promise<void> {
      if (!editor || !ownEntry) throw new Error('配置不可写')
      await editor.edit(ownEntry, current => ({ ...current, ...patch }))
      try {
        ctx.emit('system-prompt/change')
      } catch {
        // 已保存；下一轮模型请求会重建提示词。
      }
    }

    function snapshot(sessionId?: string) {
      const settings = readSettings()
      const bound = personaFor(sessionId ?? null)
      const personas = discoverPersonas(settings, new Date(), bound)
      const active = personas.activePersonas[0] ?? null
      return {
        settings,
        personas,
        active,
        bound,
        list: personas.allPersonas.map(persona => ({
          label: shortName(persona.displayName, persona.id),
          description: persona.source === 'builtin' ? '内置' : '外部',
          value: persona.id,
        })),
      }
    }

    /** 面板数据模型：data 推送和操作后的 patch 都用它，保证两者结构一致。 */
    function personaPanelData(sessionId?: string) {
      const current = snapshot(sessionId)
      const active = current.active
      return {
        activeId: active?.id ?? '',
        activeName: active ? shortName(active.displayName, active.id) : '未启用',
        activeDesc: active?.description ?? '',
        activeLogo: active ? (previewRef(active, current.settings.preferredImageMode) ?? logoRef(active) ?? '') : '',
        activeSource: active ? (active.source === 'builtin' ? '内置' : '外部') : '',
        boundLabel: !sessionId ? '默认人设' : current.bound !== null ? '本会话已单独绑定' : '跟随默认',
        notice: '',
        imageModeLabel: current.settings.preferredImageMode === 'secondary' ? '第二参考图' : '写实形象',
        countLabel: `${current.personas.allPersonas.length} 个`,
        options: current.list,
      }
    }

    function settingsPanelData() {
      const current = snapshot()
      const settings = current.settings
      const active = current.active
      const canEdit = writable()
      return {
        notice: '',
        enabledValue: settings.enabled ? 'on' : 'off',
        enabledLabel: settings.enabled ? '已启用' : '已停用',
        activeId: active?.id ?? 'none',
        activeName: active ? shortName(active.displayName, active.id) : '不使用',
        imageMode: settings.preferredImageMode,
        imageModeLabel: settings.preferredImageMode === 'secondary' ? '第二参考图' : '写实形象',
        scanValue: settings.scanExternalDirs ? 'on' : 'off',
        timeFallback: settings.timeFallback,
        externalDirLabel: settings.externalPluginsDir !== '' ? settings.externalPluginsDir : '默认 ~/.dsh/personas',
        timeZoneLabel: settings.timeZone !== '' ? settings.timeZone : '自动（本机时区）',
        countLabel: `${current.personas.allPersonas.length} 个`,
        cardValue: settings.showSidebarCard ? 'on' : 'off',
        widthValue: String(settings.sidebarCardWidth ?? 0),
        options: [{ label: '不使用人设', value: 'none' }, ...current.list],
        writableLabel: canEdit ? '可在手机上修改' : '当前配置只读',
        tone: canEdit ? 'good' : 'warn',
      }
    }

    // The bridge retains feeds across panel reopens. Update every live scope after a
    // Web or native edit, even if the invoke and subscription carry different scopes.
    function subscribe(update: () => void) {
      update()
      return child.on('system-prompt/change', update)
    }

    function panelError(notice: string) {
      return { patch: { notice } }
    }

    dshGo.strip('persona', ({ sessionId }, emit) => subscribe(() => {
      const { active } = snapshot(sessionId)
      emit({
        text: active ? `人设 · ${shortName(active.displayName, active.id)}` : '人设 · 未启用',
        icon: 'user',
        tone: active ? 'good' : 'muted',
      })
    }))

    dshGo.panel('personas', {
      view: ({ sessionId }) => ({
        v: 1,
        type: 'stack',
        title: '人设控制台',
        children: [
          {
            type: 'image',
            src: { $: 'data.activeLogo' },
            aspect: 1,
            alt: { $: 'data.activeName' },
            caption: { $: 'data.activeDesc' },
          },
          {
            type: 'keyValue',
            items: [
              ['当前', { $: 'data.activeName' }],
              ['来源', { $: 'data.activeSource' }],
              ['形象', { $: 'data.imageModeLabel' }],
              ['名册', { $: 'data.countLabel' }],
            ],
          },
          { type: 'options', id: 'switch', options: { $: 'data.options' }, selected: { $: 'data.activeId' } },
          {
            type: 'actions',
            items: [
              { label: '切换形象', action: 'image-mode', icon: 'image' },
              ...(sessionId ? [{ label: '跟随默认', action: 'follow-default', icon: 'user' }] : []),
              { label: '刷新', action: 'refresh', style: 'plain', icon: 'refresh' },
            ],
          },
          { type: 'callout', text: { $: 'data.boundLabel' }, tone: 'info' },
          { type: 'text', text: { $: 'data.notice' } },
        ],
      }),
      data: (scope, emit) => subscribe(() => {
        try {
          emit(personaPanelData(scope?.sessionId))
        } catch {
          emit({ activeId: '', activeName: '读取失败', activeLogo: '', options: [], countLabel: '—' })
        }
      }),
      actions: {
        switch: async ({ sessionId }, event) => {
          const id = event.value?.value
          if (typeof id !== 'string' || !snapshot().list.some(persona => persona.value === id)) {
            return panelError('这个人设不在名册里，刷新后再选')
          }
          if (!writable()) return panelError('当前配置只读')
          try {
            if (sessionId) await setSessionPersona(sessionId, id)
            else await patchSettings({ activePersona: id, enabled: true })
            return { patch: personaPanelData(sessionId) }
          } catch {
            return panelError('切换失败，请刷新后重试')
          }
        },
        'follow-default': async ({ sessionId }) => {
          if (!sessionId) return panelError('请先打开一个会话')
          if (!writable()) return panelError('当前配置只读')
          try {
            await setSessionPersona(sessionId, null)
            return { patch: personaPanelData(sessionId) }
          } catch {
            return panelError('恢复默认失败，请刷新后重试')
          }
        },
        'image-mode': async scope => {
          if (!writable()) return panelError('当前配置只读')
          const next = readSettings().preferredImageMode === 'secondary' ? 'realistic' : 'secondary'
          try {
            await patchSettings({ preferredImageMode: next })
            return { patch: personaPanelData(scope?.sessionId) }
          } catch {
            return panelError('形象切换失败，请重试')
          }
        },
        refresh: ({ sessionId }) => ({ patch: personaPanelData(sessionId) }),
      },
    })

    dshGo.panel('persona-settings', {
      view: () => ({
        v: 1,
        type: 'stack',
        title: '人设控制台设置',
        children: [
          {
            type: 'keyValue',
            items: [
              ['状态', { $: 'data.enabledLabel' }],
              ['默认人设', { $: 'data.activeName' }],
              ['生图基准', { $: 'data.imageModeLabel' }],
              ['名册', { $: 'data.countLabel' }],
              ['外部目录', { $: 'data.externalDirLabel' }],
              ['时区', { $: 'data.timeZoneLabel' }],
            ],
          },
          { type: 'text', text: '启用状态', tone: 'muted' },
          {
            type: 'options',
            id: 'set-enabled',
            options: [{ label: '启用', value: 'on' }, { label: '停用', value: 'off' }],
            selected: { $: 'data.enabledValue' },
          },
          { type: 'text', text: '默认人设（网页版右栏、新会话都看这里）', tone: 'muted' },
          { type: 'options', id: 'set-persona', options: { $: 'data.options' }, selected: { $: 'data.activeId' } },
          { type: 'text', text: '生图形象基准', tone: 'muted' },
          {
            type: 'options',
            id: 'set-image',
            options: [{ label: '写实形象', value: 'realistic' }, { label: '第二参考图', value: 'secondary' }],
            selected: { $: 'data.imageMode' },
          },
          { type: 'text', text: '外部人设目录', tone: 'muted' },
          {
            type: 'options',
            id: 'set-scan',
            options: [{ label: '扫描', value: 'on' }, { label: '不扫描', value: 'off' }],
            selected: { $: 'data.scanValue' },
          },
          { type: 'text', text: '时间注入回退', tone: 'muted' },
          {
            type: 'options',
            id: 'set-time',
            options: [
              { label: '自动', value: 'auto' },
              { label: '总是注入', value: 'always' },
              { label: '关闭', value: 'off' },
            ],
            selected: { $: 'data.timeFallback' },
          },
          { type: 'text', text: '网页版左侧栏角色卡', tone: 'muted' },
          {
            type: 'options',
            id: 'set-card',
            options: [{ label: '显示', value: 'on' }, { label: '隐藏', value: 'off' }],
            selected: { $: 'data.cardValue' },
          },
          { type: 'text', text: '角色卡宽度（仅网页版）', tone: 'muted' },
          {
            type: 'options',
            id: 'set-width',
            options: [
              { label: '自适应', value: '0' },
              { label: '200 px', value: '200' },
              { label: '240 px', value: '240' },
              { label: '300 px', value: '300' },
              { label: '360 px', value: '360' },
            ],
            selected: { $: 'data.widthValue' },
          },
          {
            type: 'actions',
            items: [
              { label: '打开 App 设置', action: 'open-app-settings', icon: 'settings' },
              { label: '刷新', action: 'refresh-settings', style: 'plain', icon: 'refresh' },
            ],
          },
          { type: 'callout', text: { $: 'data.writableLabel' }, tone: { $: 'data.tone' } },
          { type: 'text', text: { $: 'data.notice' } },
        ],
      }),
      data: (_scope, emit) => subscribe(() => {
        try {
          emit(settingsPanelData())
        } catch {
          emit({ enabledValue: 'off', activeId: 'none', options: [], writableLabel: '读取失败', tone: 'bad' })
        }
      }),
      actions: {
        'set-enabled': async (_scope, event) => {
          const value = typeof event?.value?.value === 'string' ? event.value.value : ''
          if (value !== 'on' && value !== 'off') return panelError('没认出这个选项')
          if (!writable()) return panelError('当前配置只读')
          try {
            await patchSettings({ enabled: value === 'on' })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'set-persona': async (_scope, event) => {
          const id = typeof event?.value?.value === 'string' ? event.value.value : ''
          if (id === '') return panelError('没认出这是哪个人设')
          if (!writable()) return panelError('当前配置只读')
          if (id !== 'none' && !snapshot().personas.allPersonas.some(persona => persona.id === id)) {
            return panelError('这个人设不在名册里，刷新后再选')
          }
          try {
            await patchSettings({ activePersona: id === 'none' ? 'none' : id })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'set-image': async (_scope, event) => {
          const value = typeof event?.value?.value === 'string' ? event.value.value : ''
          if (value !== 'realistic' && value !== 'secondary') return panelError('没认出这个选项')
          if (!writable()) return panelError('当前配置只读')
          try {
            await patchSettings({ preferredImageMode: value })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'set-scan': async (_scope, event) => {
          const value = typeof event?.value?.value === 'string' ? event.value.value : ''
          if (value !== 'on' && value !== 'off') return panelError('没认出这个选项')
          if (!writable()) return panelError('当前配置只读')
          try {
            await patchSettings({ scanExternalDirs: value === 'on' })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'set-time': async (_scope, event) => {
          const value = typeof event?.value?.value === 'string' ? event.value.value : ''
          if (!['auto', 'always', 'off'].includes(value)) return panelError('没认出这个选项')
          if (!writable()) return panelError('当前配置只读')
          try {
            await patchSettings({ timeFallback: value as PersonaHubSettings['timeFallback'] })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'set-card': async (_scope, event) => {
          const value = typeof event?.value?.value === 'string' ? event.value.value : ''
          if (value !== 'on' && value !== 'off') return panelError('没认出这个选项')
          if (!writable()) return panelError('当前配置只读')
          try {
            await patchSettings({ showSidebarCard: value === 'on' })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'set-width': async (_scope, event) => {
          const value = Number(typeof event?.value?.value === 'string' ? event.value.value : NaN)
          if (![0, 200, 240, 300, 360].includes(value)) return panelError('没认出这个宽度')
          if (!writable()) return panelError('当前配置只读')
          try {
            await patchSettings({ sidebarCardWidth: value })
            return { patch: settingsPanelData() }
          } catch {
            return panelError('保存失败，请重试')
          }
        },
        'refresh-settings': () => ({ patch: settingsPanelData() }),
        'open-app-settings': () => ({ open: 'settings' }),
      },
    })
  })
}
