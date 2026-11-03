# 架构说明

> 本文说明 `dsh-chat-background` 的两半结构、数据流、关键不变量与扩展方式；修改代码前请先读本文。
> 相关：[CONVENTIONS.md](CONVENTIONS.md) · [DEVELOPMENT.md](DEVELOPMENT.md) · [TESTING.md](TESTING.md)

## 1. 插件是什么

`dsh-chat-background` 是一个 **DSH bundle 插件**（Cordis loader 的 patch 条目 + 宿主半 + 浏览器半），
给 DeepSeek Harness 桌面端的 Web 界面加一层可配置的视觉背景：

- 背景图片（来自 `~/.dsh/backgrounds/`）铺满界面；左侧栏、中间主窗口、右侧边栏各有独立的 0–100 遮罩层；
- 输入栏下方一条与输入卡片等宽、包住用量数据的背景条；
- 输入栏上方的任务进度条；
- 侧栏账号行上方的全会话 Token 总用量。

设置入口是 **设置 → 页面设置**（本插件独占的分区）：**背景**标签 6 行 + **UI**标签 3 组卡片。

## 2. 两半结构

```text
┌──────────────────────────── DSH Host (Node / Electron main) ────────────────────────────┐
│  index.js                 apply(ctx) → 注册 5 条 Web 路由（ctx.webServer.register）      │
│    host/constants.js      路由路径、图片缓存策略、token 缓存窗口                          │
│    host/paths.js          DSH_HOME / backgrounds 目录解析（支持环境变量覆盖）              │
│    host/media.js          可接受的图片类型、文件名校验、目录清单（name/bytes/mtime/rev）    │
│    host/token-usage.js    扫描 session_projcache/*.json，汇总四个 token 桶               │
│    host/routes.js         HTTP 处理器：list / files / folder / token-total               │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ 本机回环 HTTP（/chat-backgrounds/*）
┌──────────────────────────────────────────┴─────────────────────────────────────────────┐
│  DSH Web 客户端（Electron renderer）                                                     │
│  client.js（由 src/ 构建）  window.__ModuleLoader__.load({ id, factory })                │
│    src/index.js            入口：绑定 React → createPlugin → apply                       │
│    src/plugin.js           创建设置实例、应用持久状态、注册槽位/观察者/轮询                │
│    src/background.js       应用图片/侧栏/滑杆，测量不透明容器，rAF 合并 flush              │
│    src/strip.js            输入栏下方背景条（两锚点测量 + ResizeObserver）                │
│    src/progress.js         任务进度条（todos 投影 / 本轮步数估算）                        │
│    src/token-total.js      侧栏 Token 行注入与轮询                                        │
│    src/rows.js             背景 6 行 + UI 3 组卡片（Row / SwitchRow / ColorRow / Slider）   │
│    src/storage.js          localStorage 读写 + createSwitch / createColorSetting          │
│    src/styles.js           本插件全部 CSS 规则                                            │
│    src/i18n.js / react.js  中英文案与共享语言观察者 / React 绑定                          │
│    src/constants.js        路由、存储键、属性名、滑杆范围                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. 数据流

**持久状态**：全部存在浏览器 `localStorage`（键前缀 `dsh-chat-background:`），宿主半不保存用户设置。

```text
设置行交互 ──写──▶ localStorage ──读──▶ applyBackground / renderComposerStrip / renderTokenTotal
     │                                        │
     └────────── 同步调用 ────────────────────┘  （写入后立即重绘，不等待 DOM 观察）
```

**DOM 发布**：设置值最终落到三类位置：

1. `<html>` 上的属性与内联 CSS 变量（`--dsh-chat-background-image`、三个 `--dsh-chat-background-scrim-*`、
   `--dsh-chat-strip-bg`、`--dsh-progress-color`、`--dsh-token-size`）；
2. 注入节点：`[data-dsh-chat-background-layer]`（背景图 `<img>`）、`[data-dsh-chat-strip]`（composer 包装层内）、
   `[data-dsh-token-total]`（侧栏账号行前）；
3. 静态样式表：`style[data-plugin-css="dsh-chat-background/background.css"]` 与测量生成的
   `dsh-chat-background/measured.css`。

**重绘触发**：

```text
MutationObserver(body 子树 / dark-theme 属性) ─┐
window resize ────────────────────────────────┼─▶ requestAnimationFrame 合并 ─▶ flushBackground()
composer 包装层 ResizeObserver（纯样式尺寸） ──┘        ├─ applyBackground(readSelection())
                                                        ├─ renderComposerStrip()
                                                        └─ renderTokenTotal()
```

`applyBackground` 在稳态下很便宜：只有「`[data-slot]` 数量」或「会话容器身份」变化时才重新测量不透明容器；
稳态下不写任何属性（状态快照一致时直接返回）。

## 4. 宿主半契约

五条路由（路径常量集中在 `host/constants.js`，浏览器半在 `src/constants.js` 镜像）：

| 路由                                 | 方法       | 返回                                                                                                                                      |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /chat-backgrounds/list`         | GET / HEAD | `{ folder, accepted, images: [{ name, bytes, mtimeMs, rev }] }`                                                                           |
| `GET /chat-backgrounds/files/<name>` | GET / HEAD | 图片字节；`ETag`、`cache-control: private, max-age=0, must-revalidate`（SEC-06）                                                          |
| `POST /chat-backgrounds/folder`      | POST       | `{ folder, opened: true }`；在资源管理器中打开目录                                                                                        |
| `GET /chat-backgrounds/token-total`  | GET / HEAD | `{ total, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, sessions, countedSessions, scannedAt, source, missing? }` |
| `GET /chat-backgrounds/health`       | GET / HEAD | `{ ok, version, folder, accepted, limits, fence }`                                                                                        |

失败语义：

- 未知图片 / 畸形百分号编码 / 路径穿越 → `404`；
- 方法不支持 → `405` + `Allow`；
- 目录或投影缓存读失败 → `500`，日志走 `ctx.logger.warn`；
- 每条路由都经过请求栅栏（Host/Origin/Sec-Fetch，见 §8）；错误响应同样带安全头；
- 图片超过 64 MB 返回 `413`；/files 只服务当前目录清单中的真实文件名；
- token 扫描优先走宿主服务，回退到磁盘时缓存 10 秒；文件夹在首次请求时按需创建；
- token 扫描对单个投影文件有 **8 MB 上限**（`MAX_PROJECTION_BYTES`），超大的异常文件按不参与统计处理。

设计约束：宿主半**只 import `node:` 内置模块**。profile 安装的包解析不到 DSH 安装目录里的
`@deepseek-ai/*` 包，任何这类 import 都会在加载期失败。

## 5. 浏览器半契约

- 入口：`window.__ModuleLoader__.load({ id: <package name>, factory(require) { ... } })`；
  `id` 由构建脚本从 `package.json` 注入，必须与包名一致。
- 注入服务：`inject: ['slots', 'locale']`；组件通过 `ctx.slots.inject` / `ctx.slots.register` 挂载。
- 设置分区：`settings.section` 槽，`id: chat-background`、`order: 5`（通用 0 / 模型 10 之间），
  只使用文档化的 `id/order/label/locale` 注册选项；背景标签 6 行 + UI 标签 3 组卡片由 `PageSection` 直接组合渲染，不再声明子槽。
- 进度条：注册进 `conversation.input.dock`（composer 卡片上方的整行条目），`id: chat-background-progress`、
  `order: 12`（避开宿主 GoalDock 与队列条占位）；空闲（无清单、未运行）时不渲染。
- Token 行：不是槽位，而是运行时注入 `<div data-dsh-token-total>` 到账号行前；锚点按
  `[class*="settingsArea"]` → `[data-slot="sidebar.settings"]` 父行 → footer 容器 依次尝试并校验位置。
- 清理：所有副作用都通过 `ctx.effect(...)` 注册清理函数（样式表、观察者、interval、ResizeObserver）。

### 5.0 背景区块、三区遮罩与原生标题栏

- 设置页内部有「背景 / UI」两个 pill 标签页；切换是组件内 `useState`，不产生额外路由。
- 所有设置行都经 `Row` 组件渲染：两列 grid（说明 / 控件模块）。控件组保持自身宽度并右对齐，所以语言切换、字体缩放、不同 DPI 或窗口变窄时只有位置变化，不会互相挤压或错位；滑块尺寸由变量推导，不写死像素偏移。
- **背景**标签：大图预览、当前文件名下拉框 + 「打开文件夹」「重新扫描」按钮，下方三个遮罩层滑杆；区块与行之间用默认分隔线。
- **UI**标签：背景条、进度条、Token 三组设置各用一张 `1px` 细边框 + 大圆角卡片包住，组内两行之间用默认分隔线。
- 右栏 panel 通过 `markRightPanel()` 打标：普通状态由右栏列的 `::after` 画遮罩（随列宽收缩）；全屏时**左侧栏保持可见**，只隐藏主窗口列，panel 用 offset/width 变量从左侧栏右缘开始覆盖「主窗口 + 原右栏」并绘制统一遮罩；布局 frame 通过 `markLayoutFrame()` 打标，仅在展开/收起点击的 340ms 窗口内启用 300ms `grid-template-columns` 过渡（与 app 内容动画同步），拖动宽度时不启用过渡。
- 三个遮罩层没有开关，只有 0–100 的不透明度：0 全透明、100 完全不透明；侧栏/右栏的表面始终让位于图片，由遮罩决定遮挡程度。

- 左侧栏/主窗口/右侧栏由稳定槽位（`[data-slot="sidebar"]`、`[data-slot="main"]`、`[data-slot="rightbar"]`）的父节点打标，
  各自建立 `position: relative` + `isolation: isolate` 的层叠上下文，再用 `::before`/`::after` 在 `z-index: -1` 画独立遮罩；
  因此调暗侧栏不会影响正文，反之亦然。
- app 会把 base surface 画在布局 frame、主窗口列和右侧栏上：Windows 标题栏模式还会给主窗口列铺不透明底色和 16px 圆角。
  这些表面通过**槽位标记**（`data-dsh-chat-background-main/right/frame`）清成透明，而不是只依赖一次性测量出的 `lift` 标记，
  所以列被重建、标题栏重新主题化或窗口从遮挡恢复后都不会重新变白。测量标记丢失、`data-windows-titlebar`/`data-platform`
  变化、窗口 `focus` 或 `visibilitychange` 变可见时会主动重新测量，见 `src/background.js` 的 `invalidatePainters()`。
- 窗口控制条：桌面预加载用隐藏 probe 的 `background-color: var(--dsw-specific-sidebar-fill)` 采样原生 titleBarOverlay 颜色；
  插件只在该 probe 上覆盖为透明（不改 token），并通过改写 body 自定义属性触发预加载的 observer 重新发送，见 `src/background.js`。

### 5.0.1 背景轮换

- **背景图由固定 `<img data-dsh-chat-background-layer>` 绘制**（`object-fit: cover`，`z-index: -1`，位于列与遮罩之下）；不使用 `<html>` 背景，因为 Chromium 会把根元素上的 GIF/WebP/APNG 冻结在首帧；
- `src/rotation.js` 管理轮换定时器、图片列表拉取、分组过滤和过渡层；`plugin.js` 挂载时安装，卸载时清定时器与过渡层；
- 普通/全屏右栏都由 `--dsh-chat-background-image` 对应的 `<img>` 背景层显示当前图；切换时把旧图放到 `body` 下固定、`z-index: -1` 的 `.dshcb-rotate-layer` 上，旧图淡出/主题底色层完成渐变，层位于 app 列与列遮罩之下；
- 设置行在图片选择下方依次为：背景显示方式、轮换设置（特效/时长/间隔）、轮换分组；分组为空即轮换全部。

### 5.1 设置开关与工厂

| 工厂                                                                         | 产出                                                  | 复用者                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| `createSwitch({ key, onChange })`                                            | `{ read, write, useEnabled }`；`'off'` 为关，缺省为开 | 背景条 / 进度条 / Token 三个开关 |
| `createColorSetting({ key, property, fallback, translucent, defaultToken })` | `{ read, apply, useColor }`；写 `<html>` 内联变量     | 背景条颜色 / 进度条颜色          |
| `ActiveSliderRow`                                                            | 滑杆 + 数值 + 副作用                                  | 三区遮罩 / Token 字号            |

设置实例在 `plugin.js` 的 `apply()` 中创建，经 `src/settings.js` 晚绑定给各功能模块；
这样模块导入期没有副作用，单元测试可以直接 import 纯函数模块。

## 6. 关键不变量（改代码前必读）

1. **零布局影响**：背景条、进度条、Token 行都不改 app 已算好的布局盒（绝对定位 / 独立行 / 前插节点）。
   给 composer 内的行加 `padding` / `margin` 会被座位裁剪吃掉内容。
2. **层叠顺序**：「背景图之上、所有 UI 之下」= 容器 `isolation: isolate` + 伪元素 `z-index: -1`。
   `isolation` 只建立层叠上下文，**不会**成为 `position: fixed` 后代的包含块。
3. **禁止 transform/filter/backdrop-filter**：它们会让元素成为 fixed 后代的包含块，破坏 app 的悬浮气泡定位。
4. **全量扫描要缓存**：`MutationObserver` 在流式输出时每帧触发，锚点查找必须缓存（节点离开文档才失效）。
5. **纯样式尺寸变化**：`MutationObserver` 看不到，composer 包装层另挂 `ResizeObserver`。
6. **主题 token 在 `body` 上**：`--dsw-alias-*` 由主题服务发布在 `body`，读默认色时要读 `body`。
7. **不要写死端口 / token**：验证时从 CLI 输出取 URL，不要假设桌面端端口。

## 7. 构建与产物

```text
src/*.js + src/lib/*.js ──esbuild(bundle, iife, platform=browser)──▶ client.js
host/*.js + index.js ──── 直接作为 ESM 发布（Node 原生支持多文件）──▶ npm 包
```

- **为什么浏览器半必须单文件**：DSH 客户端模块加载器按包加载一个 `client.js` 入口；
  相对多文件 `import` 不会被解析（`require.async` chunk 是构建器产出的特例）。
- **为什么 React 不打包**：React 是宿主平台共享模块，由 factory 的 `require` 提供；
  `src/react.js` 在 factory 执行时绑定，组件的 hook 全部经该绑定调用。
- **为什么提交构建产物**：用户可能用 `dsh plugin add github:...` 直接安装 Git 仓库；
  提交 `client.js` 后无需在其机器上执行构建。CI 会校验产物与 `src/` 一致（构建确定性输出）。
- **为什么用 esbuild**：单一 devDependency、无运行时依赖、可确定性输出；`npm run build` 即可复现。

## 8. 兼容与校准点

DSH 升级可能改变 DOM，插件的脆弱点与处理方式如下：

| 校准点                                                                                                                 | 位置                                                    | 失效表现                     | 处理                          |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------- | ----------------------------- |
| 用量数据行（稳定钩子 `[data-composer-dock]` + `[data-composer-stat]`；`display: contents` 包装层用子元素矩形并集度量） | `src/strip.js` 的 `findUsageRow` / `findStableUsageRow` | 背景条不出现或位置不对       | 按真实 DOM 调整钩子与形状约束 |
| 输入卡片启发式（含编辑器 + 有背景的最大盒子）                                                                          | `src/strip.js` 的 `findInputCard`                       | 背景条宽度/位置不对          | 按真实 DOM 调整               |
| 侧栏/会话容器的 CSS 模块名后缀（`sidebarCol`、`fade`、`composerSeat` 等）                                              | `src/styles.js`                                         | 侧栏透明、渐隐或底部白边异常 | 重新核对类名后缀              |
| 全屏右栏遮罩的层叠假设                                                                                                 | `src/styles.js`（panel 的 `z-index` 与 offset 变量）    | 遮罩盖住或漏盖 UI            | 检查 panel 层叠上下文         |

- **不硬编码会话根的哈希类名**：不透明容器由 `markPainters()` 逐层测量后打标，会话切换时自动重新测量；
  哈希变化不会留下死规则。
- **平台表面**：Windows 标题栏 `html[data-windows-titlebar] [class*=frame]::before`、macOS 侧栏
  `background-image` 渐变、`forced-colors` / `prefers-reduced-transparency` 分别有专门规则（`src/styles.js`）。
- **可观测性**：宿主 `/health` 与浏览器 `window.__dshcb.diagnostics()` 报告版本、限制、栅栏与各锚点选择结果；
  功能静默降级时可据此定位（`src/diagnostics.js`）。
- **兼容声明**只有 `engines.dsh`（`>=0.2.1-rc.3`）；在未声明兼容的新版本上验证通过后，再扩大范围。

## 9. 扩展指南

**新增一行设置**：`src/constants.js` 加键 → `src/i18n.js` 加中英文案 → `src/rows.js` 写行组件 →
加入 `BACKGROUND_ROWS` 或 `UI_GROUPS`（按标签页/卡片分组）→ 若引入新状态，在 `src/storage.js` 加读写。

**新增宿主路由**：`host/constants.js` 加路径 → `host/routes.js` 加处理器并导出 → `index.js` 的 `apply` 注册
→ `src/constants.js` 镜像 URL → 补单元测试。

**新增注入型视觉元素**：优先用「静态 CSS + `<html>` 属性/内联变量」表达；需要节点时由 `flushBackground`
统一调度并在 `ctx.effect` 中清理；先写单元测试覆盖纯逻辑，再用 E2E 验证真实几何。

## 10. 决策记录（简版 ADR）

| 决策                                                   | 理由                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 背景图走宿主本地 HTTP 路由，而不是 `file://` 或 base64 | 浏览器半读不到磁盘；大图 base64 会撑爆 localStorage/DOM                                |
| 设置存 localStorage，不入宿主配置                      | 纯浏览器偏好、即时生效、卸载残留可忽略；避免改 profile 配置                            |
| 图片缓存改为「必须重验证 + ETag」                      | 用户可能覆盖同名图片，`immutable` 会让旧图停留一年                                     |
| 单文件 `client.js` 产物提交入库                        | 兼容 `dsh plugin add github:` 直接安装，无需用户构建                                   |
| 浏览器半用纯 JS + esbuild，而不是 TypeScript           | 代码量适中；避免为发布引入重型构建链，产物即源码可读                                   |
| 设置分区独立成「页面设置」                             | 与内置「通用设置」同级，避免污染通用分区                                               |
| 本地 HTTP 路由自带请求栅栏                             | 宿主只提供进程边界、不提供来源策略；与 `/api` 的 Host/Origin/Sec-Fetch 模型对齐        |
| SVG 保留但以 CSP 沙箱提供                              | 用户可能用矢量壁纸；`sandbox` + `default-src none` 让顶层打开也不执行脚本              |
| token 聚合优先宿主服务、文件扫描回退                   | 磁盘布局是内部实现细节；服务不可用时仍有降级路径                                       |
| 设置行由组件直接组合，不声明子槽                       | `settings.section` 的文档化注册选项只有 id/order/label；去掉对 children 的未文档化依赖 |

## 相关文档

- [CONVENTIONS.md](CONVENTIONS.md)
- [DEVELOPMENT.md](DEVELOPMENT.md)
- [TESTING.md](TESTING.md)
