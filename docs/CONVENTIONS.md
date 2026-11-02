# 格式与风格规范

本文件是 `dsh-chat-background` 仓库的**唯一格式标准**。新增代码、文档、提交与目录结构都遵循这里的规定；
不一致的地方视为缺陷，由独立审查与 CI 指出。

> 适用范围：仓库根目录下所有源码、脚本、配置与文档。
> 强制执行方式：Prettier（`npm run format:check`）+ 静态检查（`npm run check`）+ CI（`.github/workflows/ci.yml`）。

## 1. 通用约定

| 项       | 规定                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 编码     | UTF-8，无 BOM                                                                            |
| 换行符   | LF（`.gitattributes` 强制，Windows 检出也保持 LF）                                       |
| 文件末尾 | 恰好一个换行                                                                             |
| 行尾空白 | 不允许（Markdown 有意换行除外）                                                          |
| 缩进     | 2 空格，不用 Tab                                                                         |
| 最大行宽 | 120 列                                                                                   |
| 语言     | 代码注释 / JSDoc / commit message 用英文；面向用户的文档与界面文案用中文（英文另有对应） |

## 2. 目录与文件命名

```text
根目录        只放入口、清单与社区文件（index.js / client.js / package.json / README 等）
src/          浏览器半源码，ESM，按功能拆文件，kebab-case 文件名
src/lib/      纯函数工具（不触碰 DOM，可直接被单元测试导入）
host/         宿主半源码，ESM，kebab-case 文件名
scripts/      开发/构建/检查脚本，*.mjs
scripts/e2e/  端到端测试编排与 CDP 驱动
test/unit/    单元测试，*.test.mjs
test/e2e/     测试步骤数据，*.json
docs/         维护者文档，UPPER_SNAKE_CASE.md（如 ARCHITECTURE.md）
assets/       截图与品牌资源
.github/      GitHub 社区模板与工作流
```

- 一个文件只做一件事；文件名用名词短语（`token-usage.js`、`recent-messages.js`）。
- 入口文件固定为 `index.js`（宿主半）与 `client.js`（浏览器半产物）。
- 不要新建与既有目录职责重叠的目录；不确定时先读 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 3. JavaScript / ESM

### 3.1 基本格式

```js
// ✓ 正确
export function readPercent(key, fallback, minimum, maximum) {
  return parsePercent(readString(key), fallback, minimum, maximum)
}

// ✗ 错误：分号、双引号、超宽行
export function readPercent(key, fallback, minimum, maximum) {
  return parsePercent(readString(key), fallback, minimum, maximum)
}
```

- 2 空格缩进、单引号、**不加分号**、行宽 ≤ 120、对象/数组末尾不加尾逗号（由 Prettier 保证）。
- 箭头函数参数始终带括号：`(value) => value + 1`。
- 不允许 `console.log` / `console.warn` 等：浏览器半用界面反馈，宿主半用 `ctx.logger`。
- 空 `catch` 块必须写注释说明为什么可以忽略。

### 3.2 import 顺序

按三组、组内按字母序，组间空一行：

```js
import { readFile } from 'node:fs/promises' // 1. Node 内置（node: 前缀）

import { build } from 'esbuild' // 2. 外部依赖（本项目仅开发脚本使用）

import { readString } from './storage.js' // 3. 项目内相对路径
```

- 相对导入必须带 `.js` 后缀（ESM 要求）。
- 不直接 `import react`：浏览器半的 React 由 `src/react.js` 在 factory 内绑定。

### 3.3 文档注释（JSDoc）

- **每个导出的函数 / 常量组 / 组件**必须有 JSDoc：一句话职责 + `@param` / `@returns`（类型用文字描述即可）。
- 模块顶部必须有 `/** ... */` 文件头，说明这个文件负责什么、与谁协作、有什么不变量。
- 复杂选择器、启发式、层叠规则必须在注释里写**为什么**，而不是重复代码在做什么。
- 注释用英文；`src/i18n.js` 里的界面文案是唯一的中文代码内容。

```js
/**
 * One durable on/off switch. `'off'` is the stored off state and an absent key
 * means on, so a switch costs nothing until it is turned off.
 * @param options - storage key, plus an optional side effect to run on change.
 * @returns reader, writer and the React hook for that switch.
 */
export function createSwitch({ key, onChange }) { ... }
```

### 3.4 命名

| 种类            | 规则                          | 示例                                   |
| --------------- | ----------------------------- | -------------------------------------- |
| 变量 / 函数     | camelCase                     | `readSelection`、`renderComposerStrip` |
| React 组件      | PascalCase                    | `ProgressDock`、`StripColorRow`        |
| 模块级常量      | UPPER_SNAKE_CASE              | `TOKEN_POLL_MS`、`STRIP_ATTRIBUTE`     |
| 布尔            | `is` / `has` / `can` 前缀     | `isDark`、`hasEditor`                  |
| 事件回调        | `on` + 事件                   | `onResize`、`onChange`                 |
| localStorage 键 | `dsh-chat-background:<kebab>` | `dsh-chat-background:strip-color`      |

## 4. CSS

- 所有规则集中在 `src/styles.js` 的一个模板字符串里，不新增 `<style>` 注入点。
- 每条规则单独成块；属性顺序：定位/布局 → 盒模型 → 排版 → 视觉 → 动画。
- 选择器按「背景 → 侧栏 → composer → 设置 → 控件 → 进度条 → token 行」分组，组间用 `/* ---- 组名 ---- */` 分隔。
- 不给宿主元素打标时优先用稳定的 `data-slot` / `data-*` 钩子；确实没有稳定钩子时，才允许用 CSS 模块名后缀选择器（如 `[class*="sidebarCol"]`），并在注释里写明这是升级敏感点。
- 规则若依赖某个层叠/包含块不变量，必须写注释解释原因。

## 5. JSON / YAML

- 2 空格缩进、LF、文件末尾一个换行；JSON 键按「身份 → 元数据 → 依赖 → 配置」顺序排列，不强制字母序。
- YAML 字符串优先用单引号；数组与对象保持块状，不用行内 `{}` 超过两项。
- 步骤脚本（`test/e2e/steps/*.json`）里每一步只做一件事，`check` 的 `label` 用简短中文描述期望。

## 6. Markdown

- 每篇文档**只有一个 H1**，紧随一行 `>` 元信息（适用范围 / 更新日期 / 相关文档），再进正文。
- 章节用 `## 1. 标题` 编号（长文档必须编号）；子节 `### 1.1 标题`。
- 表格必须对齐竖线、表头与单元格两侧留空格；长表格前留一个空行。
- 代码块必须标注语言（`bash` / `js` / `json` / `text` / `powershell`）。
- 列表、代码块、表格前后各留一个空行。
- 中文与英文/数字之间留一个半角空格；中文句子用全角标点，代码、键名、路径用反引号包裹。
- 站内链接用相对路径（如 `docs/TESTING.md`），指向外部资源用完整 URL。
- 图片语法 `![描述](assets/screenshots/xxx.png)`，描述写清楚画面内容。
- 文档末尾必须有一节 `## 相关文档`，列出 1–5 个最相关的文档链接。

### 6.1 文档模板

```markdown
# 文档标题

> 一句话说明本文档解决什么问题 / 适用对象。
> 相关：[ARCHITECTURE.md](ARCHITECTURE.md) · [TESTING.md](TESTING.md)

## 1. 第一节

...

## 相关文档

- [ARCHITECTURE.md](ARCHITECTURE.md)
```

## 7. 提交与分支

- 提交信息：`type(scope): subject`，英文、祈使句、≤ 72 字符首行；正文说明动机与验证方式。
- `type` 见 [CONTRIBUTING.md](../CONTRIBUTING.md)；`scope` 取 `host` / `client` / `styles` / `e2e` / `docs` / `repo`。
- 一个提交只做一件事；`client.js` 构建产物与对应源码改动放在同一个提交里。
- 分支命名：`feat/`、`fix/`、`docs/`、`chore/` + 简短英文短语。

## 8. i18n 文案

- 所有用户可见文案集中在 `src/i18n.js` 的 `zh` / `en` 两个对象里，键集合必须完全一致（`scripts/check.mjs` 校验）。
- 键名 camelCase、以语义命名（`stripColorTitle`），不按出现顺序编号。
- 带占位符的文案统一用 `{name}` 形式，例如 `{steps}`、`{exact}`。
- 新增设置行的同时补 `locale/zh.json` 与 `locale/en.json` 的 `meta`（仅当包级展示信息变化时需要）。

## 9. 自动执行矩阵

| 规则                                                                 | 执行者              | 命令                                      |
| -------------------------------------------------------------------- | ------------------- | ----------------------------------------- |
| 缩进/引号/分号/行宽/Markdown 表格                                    | Prettier            | `npm run format` / `npm run format:check` |
| 文件存在性、清单字段、locale、构建产物新鲜度、编码/换行、i18n 键一致 | `scripts/check.mjs` | `npm run check`                           |
| 纯函数行为                                                           | Node 内置测试       | `npm run test:unit`                       |
| 真实界面行为                                                         | CDP 端到端套件      | `npm run test:e2e`                        |
| 全部上游检查                                                         | CI                  | `.github/workflows/ci.yml`                |

## 10. 例外

- `assets/screenshots/` 是二进制证据，不做格式化。
- 历史 `client.js` 产物由构建脚本生成，格式由 esbuild 决定，不手工整理。

## 相关文档

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEVELOPMENT.md](DEVELOPMENT.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
