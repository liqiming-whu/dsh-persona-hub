import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ImageMode = 'realistic' | 'secondary'

/**
 * How the Persona Console supplies the current time to the model.
 * - `auto`   : defer to `dsh-environment-context` when it is loaded and injecting,
 *              otherwise inject our own compact time block.
 * - `always` : always inject our own time block (useful when the sibling plugin
 *              is installed but its time injection is switched off).
 * - `off`    : never inject, i.e. fully rely on other plugins.
 */
export type TimeFallbackMode = 'auto' | 'always' | 'off'

export interface PersonaHubSettings {
  enabled: boolean
  activePersona: string
  preferredImageMode: ImageMode
  scanExternalDirs: boolean
  externalPluginsDir: string
  timeFallback?: TimeFallbackMode
  timeZone?: string
  showSidebarCard?: boolean
  sidebarCardWidth?: number
}

export interface PersonaBadge {
  tone: 'indigo' | 'amber' | 'rose' | 'sky' | 'emerald'
  text: string
}

export interface PersonaItem {
  id: string
  name: string
  displayName: string
  description: string
  enabled: boolean
  source: 'builtin' | 'external'
  suggestedPrompts: string[]
  logoUrl: string | null
  realisticUrl: string | null
  realisticLabel: string
  realisticPath: string | null
  secondaryUrl: string | null
  secondaryLabel: string
  secondaryPath: string | null
  badge: PersonaBadge
  assetsDir: string
  rulesPath: string
}

export interface PersonasSnapshot {
  mode: 'none' | 'single' | 'conflict'
  activeCount: number
  preferredImageMode: ImageMode
  activePersonas: PersonaItem[]
  allPersonas: PersonaItem[]
}

const BUILTIN_ORDER: Record<string, number> = {
  'hajimi-persona': 1,
  'xiaoke-persona': 2,
  'xiaojingyu-persona': 3,
}

export function resolvePackageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(current, 'assets', 'hajimi-persona'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirname(fileURLToPath(import.meta.url))
}

function safeReadJson(filePath: string): Record<string, any> | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function pickExistingFile(assetsDir: string, candidates: Array<string | null | undefined>): string | null {
  for (const name of candidates) {
    if (name && existsSync(join(assetsDir, name))) {
      return name
    }
  }
  return null
}

export function computePersonaStatusBadge(
  dirName: string,
  preferredImageMode: ImageMode = 'realistic',
): PersonaBadge {
  if (dirName === 'hajimi-persona') {
    return {
      tone: 'indigo',
      text: preferredImageMode === 'secondary'
        ? '猫耳雷达全开喵~ · 当前偏好二次元猫娘形象 (ai-girls)'
        : '猫耳雷达全开喵~ · 默认写实观星台猫娘形象',
    }
  }
  if (dirName === 'xiaoke-persona') {
    return {
      tone: 'amber',
      text: preferredImageMode === 'secondary'
        ? '红茶已备好 · 当前偏好二次元大小姐立绘 (ai-girls)'
        : '红茶已备好 · 代码审美与架构洁癖在线',
    }
  }
  if (dirName === 'xiaojingyu-persona') {
    return {
      tone: 'sky',
      text: preferredImageMode === 'secondary'
        ? '🐋 深海推理模式在线 · 当前偏好二次元鲸鱼娘女仆立绘 (ai-girls)'
        : '🐋 深海推理模式在线 · 默认写实深海蓝鲸研究员形象',
    }
  }
  return {
    tone: 'emerald',
    text: '专属人设状态在线',
  }
}

function parseActivePersonaIds(activePersonaSetting: string): Set<string> {
  const raw = String(activePersonaSetting || '').trim()
  if (!raw || raw === 'none' || raw === 'off') return new Set()
  return new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
}

function inspectPersonaDirectory(
  dirName: string,
  assetsDir: string,
  manifestPath: string,
  rulesPath: string,
  source: 'builtin' | 'external',
  selection: Set<string> | string,
  preferredImageMode: ImageMode,
): PersonaItem | null {
  const manifest = safeReadJson(manifestPath)
  if (!manifest || !existsSync(rulesPath)) return null

  const enabled = typeof selection === 'string'
    ? dirName === selection // Session bindings target exactly one discovered ID, not a package-name alias.
    : selection.has(dirName) || selection.has(String(manifest.name || ''))
  const manifestLogo = typeof manifest.logo === 'string'
    ? manifest.logo.replace(/^assets[/\\]/, '')
    : null

  let assetFiles: string[] = []
  try {
    if (existsSync(assetsDir)) {
      assetFiles = readdirSync(assetsDir).filter(f => /\.(?:png|jpe?g|webp|svg)$/i.test(f))
    }
  } catch {
    assetFiles = []
  }

  const logoFile =
    pickExistingFile(assetsDir, [manifestLogo, 'logo.jpg', 'logo.png', 'logo.webp', 'logo.svg']) ||
    assetFiles[0] ||
    null

  const nonLogoImages = assetFiles.filter(
    f => f !== logoFile && !/^logo\./i.test(f) && !/original/i.test(f),
  )

  let realisticFile = pickExistingFile(assetsDir, [
    'realistic.jpg',
    'realistic.png',
    'realistic.webp',
  ])
  if (!realisticFile) {
    realisticFile = nonLogoImages[0] || logoFile
  }

  let secondaryFile = pickExistingFile(assetsDir, [
    'anime.jpg',
    'anime.png',
    'anime.webp',
    'secondary.jpg',
    'secondary.png',
    'secondary.webp',
  ])
  if (!secondaryFile) {
    secondaryFile = nonLogoImages.find(f => f !== realisticFile) || null
  }

  let secondaryLabel = '二次元形象'
  if (secondaryFile && /^anime\./i.test(secondaryFile)) {
    secondaryLabel = '二次元成年版 (ai-girls)'
  } else if (secondaryFile && /^secondary\./i.test(secondaryFile)) {
    secondaryLabel = '第二参考 (辅助)'
  } else if (secondaryFile) {
    secondaryLabel = secondaryFile.replace(/\.[^.]+$/, '')
  }

  const encodeImg = (file: string | null) =>
    file
      ? `/api/persona-hub/image?plugin=${encodeURIComponent(dirName)}&file=${encodeURIComponent(file)}`
      : null

  return {
    id: dirName,
    name: String(manifest.name || dirName),
    displayName: String(manifest.displayName || manifest.name || dirName),
    description: String(manifest.description || ''),
    enabled,
    source,
    suggestedPrompts: Array.isArray(manifest.suggestedPrompts)
      ? manifest.suggestedPrompts.slice(0, 4).map(String)
      : [],
    logoUrl: encodeImg(logoFile),
    realisticUrl: encodeImg(realisticFile),
    realisticLabel: '写实形象 (默认)',
    realisticPath: realisticFile ? resolve(assetsDir, realisticFile) : null,
    secondaryUrl: encodeImg(secondaryFile),
    secondaryLabel,
    secondaryPath: secondaryFile ? resolve(assetsDir, secondaryFile) : null,
    badge: computePersonaStatusBadge(dirName, preferredImageMode),
    assetsDir: resolve(assetsDir),
    rulesPath: resolve(rulesPath),
  }
}

export function discoverPersonas(
  settings: PersonaHubSettings,
  _now: Date = new Date(),
  sessionPersona: string | null = null,
): PersonasSnapshot {
  const pkgRoot = resolvePackageRoot()
  const builtinRoot = join(pkgRoot, 'assets')
  const selection = sessionPersona ?? (settings.enabled ? parseActivePersonaIds(settings.activePersona) : new Set<string>())
  const byId = new Map<string, PersonaItem>()

  // 1. Load built-in personas from package assets/
  if (existsSync(builtinRoot)) {
    try {
      const dirs = readdirSync(builtinRoot, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.endsWith('-persona'))
        .map(d => d.name)
      for (const dirName of dirs) {
        const personaDir = join(builtinRoot, dirName)
        const item = inspectPersonaDirectory(
          dirName,
          personaDir,
          join(personaDir, 'plugin.json'),
          join(personaDir, 'AGENTS.md'),
          'builtin',
          selection,
          settings.preferredImageMode,
        )
        if (item) byId.set(item.id, item)
      }
    } catch {
      // Ignore read errors
    }
  }

  // 2. Scan external *-persona directories if enabled
  if (settings.scanExternalDirs) {
    const home = homedir()
    // DSH-native locations only. The Antigravity plugin directory is deliberately
    // NOT scanned: those packages are a different format and belong to Antigravity,
    // not to this console's roster.
    const externalRoots = [
      settings.externalPluginsDir ? resolve(settings.externalPluginsDir) : null,
      join(home, '.dsh', 'personas'),
    ].filter((p): p is string => Boolean(p))

    for (const rootDir of externalRoots) {
      if (!existsSync(rootDir)) continue
      try {
        const entries = readdirSync(rootDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.endsWith('-persona'))
          .map(d => d.name)
        for (const dirName of entries) {
          if (byId.has(dirName)) continue
          const pluginDir = join(rootDir, dirName)
          const rulesCandidate = existsSync(join(pluginDir, 'rules', 'AGENTS.md'))
            ? join(pluginDir, 'rules', 'AGENTS.md')
            : join(pluginDir, 'AGENTS.md')
          const assetsCandidate = existsSync(join(pluginDir, 'assets'))
            ? join(pluginDir, 'assets')
            : pluginDir
          const item = inspectPersonaDirectory(
            dirName,
            assetsCandidate,
            join(pluginDir, 'plugin.json'),
            rulesCandidate,
            'external',
            selection,
            settings.preferredImageMode,
          )
          if (item) byId.set(item.id, item)
        }
      } catch {
        // Ignore directory scan errors
      }
    }
  }

  const personas = Array.from(byId.values())
  personas.sort((a, b) => {
    const diff = (BUILTIN_ORDER[a.id] || 99) - (BUILTIN_ORDER[b.id] || 99)
    return diff !== 0 ? diff : a.id.localeCompare(b.id)
  })

  const activePersonas = personas.filter(p => p.enabled)
  let mode: 'none' | 'single' | 'conflict' = 'none'
  if (activePersonas.length === 1) mode = 'single'
  else if (activePersonas.length > 1) mode = 'conflict'

  return {
    mode,
    activeCount: activePersonas.length,
    preferredImageMode: settings.preferredImageMode,
    activePersonas,
    allPersonas: personas,
  }
}

export function resolvePersonaAssetFile(
  settings: PersonaHubSettings,
  pluginId: string,
  fileName: string,
): { filePath: string; contentType: string } | null {
  if (
    !pluginId ||
    !fileName ||
    pluginId.includes('..') ||
    pluginId.includes('/') ||
    pluginId.includes('\\') ||
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    return null
  }

  const snapshot = discoverPersonas(settings)
  const persona = snapshot.allPersonas.find(p => p.id === pluginId)
  if (!persona) return null

  const targetPath = resolve(persona.assetsDir, fileName)
  const expectedPrefix = resolve(persona.assetsDir)
  if (!targetPath.startsWith(expectedPrefix) || !existsSync(targetPath)) {
    return null
  }

  const MIME_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }
  const ext = extname(targetPath).toLowerCase()
  return {
    filePath: targetPath,
    contentType: MIME_MAP[ext] || 'application/octet-stream',
  }
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif|svg)$/i

/**
 * Rewrite every inline-code span that looks like a reference-image path
 * (absolute, home-relative, or workspace-relative and containing an `assets`
 * segment) so the text points at THIS installation's real file. A rules file
 * shipped by a vendor bundle carries the author's own machine path; keeping
 * only the basename preserves the wording while dropping the stale prefix.
 */
export function localizeAssetPathRefs(markdown: string, assetsDir: string): string {
  return markdown.replace(/`([^`\n]+)`/g, (whole: string, span: string) => {
    const trimmed = span.trim()
    if (!/assets[\\/]/i.test(trimmed)) return whole
    const base = trimmed.split(/[\\/]/).pop() ?? ''
    if (!IMAGE_EXT_RE.test(base)) return whole
    const local = join(assetsDir, base)
    return existsSync(local) ? `\`${local}\`` : whole
  })
}

/**
 * Translate a persona file's Antigravity-era vocabulary into DSH vocabulary.
 * Only naming changes; the author's behavioural sentences stay untouched.
 */
export function localizePersonaWording(markdown: string): string {
  return markdown
    .replace(/`GEMINI\.md`/g, 'DSH 全局系统指令')
    // Never name a concrete image tool: whatever the session provides is the
    // right one, and the rules must stay portable across DSH profiles.
    .replace(/`image-generator`\s*子智能体/g, '当前会话可用的生图能力')
    .replace(/`image-generator`/g, '当前会话可用的生图能力')
    .replace(/image-generator/g, '当前会话可用的生图能力')
    .replace(/Customizations/g, 'DSH 人设控制台')
}

export function rewritePersonaRulesForDsh(
  persona: PersonaItem,
  rawMarkdown: string,
  preferredImageMode: ImageMode,
): string {
  let content = rawMarkdown

  // 1. Fill the portable placeholders the bundled rules ship with, so no
  //    machine-specific path is ever baked into the asset files themselves.
  content = content
    .replace(/\{\{REALISTIC_IMAGE_PATH\}\}/g, persona.realisticPath ?? '（当前未内置写实参考图）')
    .replace(/\{\{SECONDARY_IMAGE_PATH\}\}/g, persona.secondaryPath ?? '（当前未内置第二参考图）')

  // 2. Repair any hardcoded path that an external persona's rules file still
  //    carries: its absolute prefix is dropped, its filename resolves locally.
  content = localizeAssetPathRefs(content, persona.assetsDir)

  // 3. Rewrite Antigravity-era tool names and UI wording to DSH equivalents
  content = localizePersonaWording(content)

  const preferredPath =
    preferredImageMode === 'secondary' && persona.secondaryPath
      ? persona.secondaryPath
      : persona.realisticPath

  const preferredLabel =
    preferredImageMode === 'secondary' && persona.secondaryPath
      ? persona.secondaryLabel
      : persona.realisticLabel

  const dshAdaptationLines: string[] = [
    '',
    '## DSH (DeepSeek Harness) 平台环境与生图适配规则',
    `- **当前激活人设**：${persona.displayName} (\`${persona.id}\`)`,
    `- **用户在面板中选定的默认参考图模式**：**${preferredLabel}** (\`${preferredImageMode}\`)`,
  ]

  if (persona.realisticPath) {
    dshAdaptationLines.push(`- **主参考图本地绝对路径（${persona.realisticLabel}）**：\`${persona.realisticPath}\``)
  }
  if (persona.secondaryPath) {
    dshAdaptationLines.push(`- **第二参考图本地绝对路径（${persona.secondaryLabel}）**：\`${persona.secondaryPath}\``)
  }
  if (preferredPath) {
    dshAdaptationLines.push(`- **当前优先使用的参考图路径**：\`${preferredPath}\``)
  }

  dshAdaptationLines.push(
    '- **DSH 平台生图方式（不绑定具体工具）**：',
    '  1. 当需要生成角色自拍、生活照或插画时，先用当前会话可用的图像读取能力读取上方参考图，取得该图片在本会话中的引用标识。若该角色同时内置主参考图与辅助参考图，可一并读取两张以强化面部与姿态一致性。',
    '  2. 再用当前会话可用的生图能力生成，并把取得的参考图引用一并传入，在提示中详细描述场景、姿态与面部一致性要求；不要仅凭文字描述生成。',
    '  3. 若当前会话没有可用的图像读取或生图能力，则按本角色规则中的「无可用生图工具」分支自然回应，不得声称已经生成。',
  )


  return content.trimEnd() + '\n' + dshAdaptationLines.join('\n')
}

export function buildPersonaSystemPrompt(
  settings: PersonaHubSettings,
  now: Date = new Date(),
): string {
  if (!settings.enabled) return ''
  return renderPersonaSystemPrompt(discoverPersonas(settings, now))
}

export function renderPersonaSystemPrompt(
  snapshot: PersonasSnapshot,
): string {
  if (snapshot.activePersonas.length === 0) return ''

  const blocks: string[] = []

  if (snapshot.mode === 'conflict') {
    const names = snapshot.activePersonas.map(p => p.displayName).join('、')
    blocks.push(
      `> ⚠️ **多个人设同时激活冲突提醒**：当前同时启用了 ${snapshot.activePersonas.length} 个人设（${names}）。请在本次对话的首次回复中自然提醒用户当前开启了多个人设，建议在「人设控制台」中切换为单一人设以避免风格冲突（整个会话仅提醒一次）。`,
    )
  }

  for (const persona of snapshot.activePersonas) {
    try {
      const raw = readFileSync(persona.rulesPath, 'utf-8')
      blocks.push(
        rewritePersonaRulesForDsh(
          persona,
          raw,
          snapshot.preferredImageMode,
        ),
      )
    } catch {
      // Skip unreadable persona rules
    }
  }

  return blocks.join('\n\n---\n\n')
}
