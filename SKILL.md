# Persona Assistant — 人设管理操作手册

> 本 Skill 由 `dsh-persona-hub`（人设控制台）内置，用于**指导并执行**人设插件的创建、导入、移植、验证与删除。
> 所有路径约定：人设 id 必须以 `-persona` 结尾；外部人设目录为 `~/.dsh/personas/<name>-persona`。

---

## 0. 前置检查（每次会话先做一次）

```bash
# 1) hub 是否在线：找到返回 JSON 的端口（注意 SPA 兜底也会回 200 text/html，必须看 content-type）
for p in $(netstat -ano -p tcp | grep -i listening | awk '{print $2}' | grep '^127\.0\.0\.1:' | cut -d: -f2 | sort -u); do
  ct=$(curl -s -m 1 -o /dev/null -w "%{content_type}" "http://127.0.0.1:$p/api/persona-hub/status")
  case "$ct" in *json*) echo "DSH_PORT=$p";; esac
done

# 2) 当前人设与外部扫描开关
curl -s "http://127.0.0.1:<DSH_PORT>/api/persona-hub/status" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('active=',d.settings.activePersona,'scanExternalDirs=',d.settings.scanExternalDirs);
console.log(d.personas.allPersonas.map(p=>p.id+'/'+p.source).join(', '));"
```

- `scanExternalDirs=false` 时外部人设**不会**被发现，需要：
  ```bash
  curl -s -X POST "http://127.0.0.1:<DSH_PORT>/api/persona-hub/switch" \
    -H "content-type: application/json" -d '{"scanExternalDirs":true}'
  ```

---

## 1. 从 GitHub 导入

### 1.1 拉取（gh 优先，自动带凭据）

```bash
gh --version >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 \
  && gh repo clone <owner>/<repo> -- <target-dir> --depth 1 \
  || git clone --depth 1 https://github.com/<owner>/<repo>.git <target-dir>
```

- **私有库**：`gh` 已登录时直接成功；没有 `gh` 时 `git clone` 需要预先存在的凭据（HTTPS 走 credential manager / PAT，SSH 走 key）。
  凭据缺失的典型报错：`could not read Username for 'https://github.com'` / `Permission denied (publickey)`。
  → 处理：让用户 `gh auth login`，或改用已配置好的 SSH remote；**不要**让用户把 token 贴在对话里。
- 仓库也可能是**单人多平台布局**（见 2.1）。

### 1.2 结构识别（三种布局）

```bash
find <target-dir> -maxdepth 4 \( -name plugin.json -o -name AGENTS.md \) | sort
```

| 布局 | 特征 | 取哪个目录 |
| :-- | :-- | :-- |
| A 多平台分离 | 顶层同时有 `antigravity/` 与 `dsh/` | 取 `dsh/*-persona`（**不要**用 antigravity 那份直接装进 DSH） |
| B 单平台标准 | `plugin.json` + `AGENTS.md`（或 `rules/AGENTS.md`）+ 图集 | 直接取该目录 |
| C 聚合仓库 | `person/*-persona` 多个子目录 | 用户指定哪个，取哪个 |

判断 DSH 可用性只看两件事：**有 `AGENTS.md`（或 `rules/AGENTS.md`）+ 有 `plugin.json`**。

### 1.3 安装到外部人设目录

```bash
mkdir -p ~/.dsh/personas
rm -rf ~/.dsh/personas/<name>-persona
cp -r <源目录> ~/.dsh/personas/<name>-persona
```

---

## 2. 校验清单（装完必须逐条过）

```bash
D=~/.dsh/personas/<name>-persona
ls "$D"                                                    # 必须有 plugin.json 与 AGENTS.md
node -e "const j=require('$D/plugin.json'.replace(/\\\\/g,'/'));console.log('name=',j.name,'logo=',j.logo)"  # 必填 name；logo 建议存在
grep -c "{{REALISTIC_IMAGE_PATH}}\|{{SECONDARY_IMAGE_PATH}}" "$D/AGENTS.md"   # 参考图用占位符
grep -nE "[A-Za-z]:\\\\|\.gemini|image-generator|GEMINI\.md|Customizations" "$D/AGENTS.md"  # 应无输出
```

| 检查项 | 通过标准 | 不通过怎么办 |
| :-- | :-- | :-- |
| 清单文件 | `plugin.json` 有 `name`（与目录名一致最佳） | 补字段，`name` 用目录名 |
| 角色指令 | 存在 `AGENTS.md`；若在 `rules/AGENTS.md` 也可（hub 会回落） | 无则视为不可导入 |
| 参考图 | `AGENTS.md` 用 `{{REALISTIC_IMAGE_PATH}}` / `{{SECONDARY_IMAGE_PATH}}` | 见 3.2 替换硬编码路径 |
| 图片实体 | `realistic.*` / `anime.*` 或自定义名（如 `单人书桌自拍原图.png`）存在于同目录 | 补图，或只在文字设定里引用 |
| 绝对路径 | 无 `C:\`、无 `.gemini`、无 `image-generator` | 见 3.2 |

> **已知坑**：`plugin.json` 里写 `"logo": "assets/logo.jpg"`，但 DSH 包把图片**扁平**放在根目录（没有 `assets/`）。hub 会剥掉 `assets/` 前缀再找，因此仍能正确取到 `logo.jpg`。**不要**为此改文件名。

---

## 3. 从 Antigravity 移植到 DSH

### 3.1 目录改造

```bash
SRC=~/.gemini/config/plugins/<name>-persona        # 或仓库 antigravity/<name>-persona
DST=~/.dsh/personas/<name>-persona
mkdir -p "$DST"
cp -r "$SRC"/. "$DST"/
[ -f "$DST/rules/AGENTS.md" ] && mv "$DST/rules/AGENTS.md" "$DST/AGENTS.md" && rmdir "$DST/rules" 2>/dev/null
[ -d "$DST/assets" ] && cp -r "$DST/assets"/. "$DST"/ && rm -rf "$DST/assets"   # 扁平化，Hub 两种都认
```

### 3.2 指令文本改造（`AGENTS.md`）

把作者机器上的绝对路径换成占位符，把旧平台词汇换成 DSH 词汇：

| 原文 | 改为 |
| :-- | :-- |
| `` `C:\Users\xxx\.gemini\config\plugins\...\assets\realistic.jpg` `` | `{{REALISTIC_IMAGE_PATH}}` |
| 九宫格/辅助参考图路径 | `{{SECONDARY_IMAGE_PATH}}` |
| `` `GEMINI.md` `` / 全局 Antigravity 指令 | `DSH 全局系统指令` 或 `默认系统指令` |
| `` `image-generator` `` 子智能体 | `` `codex_image_generate` `` 工具 |
| `Customizations` | `DSH 人设控制台` |

生图流程改写为：

```text
1. read_image({ file_path: "{{REALISTIC_IMAGE_PATH}}" }) 拿到 attachmentId
2. codex_image_generate({ referenceImages: [{ attachmentId }], prompt: "..." })
3. 无生图工具时按角色规则里的“无可用生图工具”分支自然回应
```

**不要**写死任何本机路径；占位符由 hub 在每次提示组装时填成本机真实绝对路径。

---

## 4. 生效与验证

```bash
PORT=<DSH_PORT>
# 打开外部扫描（若关闭）
curl -s -X POST "http://127.0.0.1:$PORT/api/persona-hub/switch" \
  -H "content-type: application/json" -d '{"scanExternalDirs":true}' >/dev/null

# 1) 是否被发现
curl -s "http://127.0.0.1:$PORT/api/persona-hub/status" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const p=d.personas.allPersonas.find(x=>x.id==='<name>-persona');
console.log(p?('FOUND source='+p.source+' logo='+p.logoUrl+' realistic='+p.realisticPath):'NOT FOUND');"

# 2) 临时激活并检查注入（验证完务必切回原人设！）
curl -s -X POST "http://127.0.0.1:$PORT/api/persona-hub/switch" -H "content-type: application/json" \
  -d '{"enabled":true,"activePersona":"<name>-persona"}' | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8')), s=d.promptPreview||'';
console.log('残留占位符=',/{{\s*(REALISTIC|SECONDARY)_IMAGE_PATH\s*}}/.test(s));
console.log('含真实路径=',/\.dsh[\\\\/]personas/.test(s));
console.log('含旧词汇=',/image-generator|GEMINI\.md|Customizations/.test(s));"

# 3) 切回原人设（把 <原来的> 换成步骤 0 读到的 activePersona）
curl -s -X POST "http://127.0.0.1:$PORT/api/persona-hub/switch" -H "content-type: application/json" \
  -d '{"enabled":true,"activePersona":"<原来的>"}' >/dev/null
```

通过标准：`残留占位符=false`、`含真实路径=true`、`含旧词汇=false`，且切换后 UI 面板能看到该人设卡与形象预览。

---

## 5. 创建全新人设

最小可用目录：

```text
~/.dsh/personas/<name>-persona/
├── plugin.json     # name / displayName / description / logo / suggestedPrompts
├── AGENTS.md       # 角色指令，参考图用 {{REALISTIC_IMAGE_PATH}}
├── logo.jpg        # 方形头像（也可 logo.svg/png）
├── realistic.png   # 主参考图（命名随意，Hub 会挑图；推荐固定名）
└── anime.jpg       # 可选，第二参考图
```

`plugin.json` 模板：

```json
{
  "name": "<name>-persona",
  "displayName": "角色名 (一句话定位)",
  "description": "给用户看的一句话介绍。",
  "logo": "logo.jpg",
  "suggestedPrompts": ["用户视角的第一句话", "用户视角的第二句话"]
}
```

- `suggestedPrompts` 必须是**用户会说的话**，不要写成角色自述。
- 角色指令至少写清：身份、性格、说话风格（含口癖克制规则）、外貌与参考图用法、以及“无生图工具时如何回应”。

---

## 6. 删除人设

```bash
D=~/.dsh/personas/<name>-persona
[ -d "$D" ] && rm -rf "$D" && echo "removed $D"
```

- 只能删 `~/.dsh/personas/` 下的**外部**人设；内置三人设随插件包发布，删除会在升级时回来——要隐藏请把 `activePersona` 切到别的人设。
- 删除前先确认它不是当前激活人设，否则先切走：
  ```bash
  curl -s -X POST "http://127.0.0.1:$PORT/api/persona-hub/switch" -H "content-type: application/json" \
    -d '{"enabled":true,"activePersona":"hajimi-persona"}' >/dev/null
  ```

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
| :-- | :-- | :-- |
| 状态里看不到新目录 | `scanExternalDirs=false`，或目录名不以 `-persona` 结尾 | 打开扫描；重命名目录 |
| 看到人设但无头像 | `plugin.json` 的 `logo` 指向不存在的文件且目录里没有 `logo.*` | 补 logo 或去掉该字段 |
| 面板里图片 404 | `AGENTS.md` 里写死了作者机器路径 | 换成占位符（3.2） |
| 注入里残留 `{{...}}` | 参考图文件缺失，占位符无值可填 | 补齐图片文件 |
| 提示里出现旧词汇 | 移植时漏改 `image-generator` / `GEMINI.md` | 按 3.2 表格批量替换 |
| 私有库 clone 失败 | 未登录 gh 且 git 无凭据 | `gh auth login`，或用已授权 SSH remote |
| 面板空白 | host 半段抛错导致设置命名空间未被 serve | 查 `plugin_manager` 日志与 `settings.section` 占用者是否 `active:true` |

---

## 8. 硬性规则

1. **不改用户已激活的人设**：任何临时激活必须在同一次操作里切回。
2. **不写死本机路径**：参考图只用占位符。
3. **不删内置人设**，只删 `~/.dsh/personas/` 下的外部目录。
4. **不索取凭据**：私有库依赖用户已配置的 gh / git 凭据；缺失就提示用户自行登录。
5. 每次改动后都要跑一遍第 4 节的验证命令，把结果如实汇报。
