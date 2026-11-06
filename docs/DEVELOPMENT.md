# 开发指南

> 面向修改本插件代码的维护者：环境、热更新规则、调试方法与常见陷阱。
> 相关：[ARCHITECTURE.md](ARCHITECTURE.md) · [TESTING.md](TESTING.md) · [CONVENTIONS.md](CONVENTIONS.md)

## 1. 环境准备

| 依赖           | 版本                     | 用途                     |
| -------------- | ------------------------ | ------------------------ |
| Node.js        | `^22.19.0 \|\| >=24.0.0` | 构建、检查、测试         |
| npm            | 随 Node                  | 安装 esbuild / prettier  |
| DSH 桌面端     | `>= 0.2.2-rc.1`          | 真实环境验证、端到端测试 |
| Edge 或 Chrome | 任意近期版本             | 无头端到端测试           |

```bash
npm install
npm run build
npm run check
npm run test:unit
```

## 2. 仓库结构与修改规则

```text
src/            浏览器半源码（改这里）→ npm run build → client.js
host/ index.js  宿主半源码（改这里，无需构建）
client.js       构建产物，不手工编辑；与源码改动一起提交
scripts/        构建/检查/E2E 编排（改这里用 node --check 验证）
test/unit/      单元测试（node:test，直接 import 源码）
test/e2e/steps/ 端到端步骤数据（JSON，不写逻辑代码）
docs/           文档；改动遵循 CONVENTIONS 的文档模板
```

- 新增浏览器功能：在 `src/` 加模块 → 被 `src/index.js` 的导入链引用（否则不会进产物）→ `npm run build`。
- 新增宿主逻辑：放进 `host/` 并由 `index.js` 或其余 host 模块 import；宿主半只能 import `node:` 内置模块。
- 浏览器半不要 import `react`：通过 `src/react.js` 的 `h` / hook 包装使用平台 React。
- 新增文案：`src/i18n.js` 的 `zh` 与 `en` 同时加，键必须一致（`npm run check` 会拦）。

## 3. 热更新规则（最重要）

| 改了什么                                      | 生效方式                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/` 下的浏览器代码                         | `npm run build` 后把 `client.js` 同步到已安装目录；DSH 客户端轮询产物并热替换，**无需重启** |
| `host/`、`index.js`                           | 宿主半模块，**需要重启 DSH 桌面端**（或依赖 DSH HMR 的 profile 重新组合）                   |
| `package.json` 的 `dsh.client` / `dsh.bundle` | 需要重启才能重新组合                                                                        |
| `locale/`、`icon.svg`、README                 | 只影响展示，无需重启                                                                        |

开发期同步到本机已安装目录（以桌面 profile 为例）：

```bash
# 浏览器半：改完立即热替换
node -e "require('node:fs').cpSync('client.js', process.env.USERPROFILE + '/.dsh/profiles/desktop/node_modules/dsh-chat-background/client.js')"

# 宿主半（需要重启应用才生效）
node -e "require('node:fs').cpSync('host', process.env.USERPROFILE + '/.dsh/profiles/desktop/node_modules/dsh-chat-background/host', { recursive: true })"
```

> 不推荐把工作区直接链接进 profile：改动宿主半会触发重新组合，可能中断正在使用的会话。
> 用 `npm run test:e2e` 在隔离实例上验证是更安全的方式。

### 3.1 安装到本机 profile

```bash
node scripts/install-local.mjs --profile desktop          # dry-run
node scripts/install-local.mjs --profile desktop --apply  # 写配置 + 拷贝文件 + 自动备份
node scripts/check-install.mjs --profile desktop --url http://127.0.0.1:<端口>
```

安装完成后**完全退出并重新打开**桌面端；确认新版本正常后再清理旧文件（profile 备份、.tmp/_scratch 等）：

```bash
node scripts/cleanup-local.mjs --profile desktop          # 先看清单
node scripts/cleanup-local.mjs --profile desktop --apply  # 删除（可加 --keep-artifacts 保留 E2E 产物）
```

## 4. 调试

- **看浏览器侧状态**：DSH 页面 DevTools（`Ctrl+Shift+I`）里检查：
  - `document.documentElement` 的 `data-dsh-chat-background` 与 `data-dsh-chat-background-right-fullscreen` 属性；
  - `<html>` / 背景层上的 `--dsh-chat-background-*`、`--dsh-chat-strip-bg`、`--dsh-progress-color`、`--dsh-token-size` 变量；
  - `localStorage` 里 `dsh-chat-background:` 开头的键；
  - `style[data-plugin-css="dsh-chat-background/background.css"]` 与 `.../measured.css` 两个样式表。
- **看宿主侧**：`GET /chat-backgrounds/list`、`/chat-backgrounds/token-total` 直接 curl 即可（公开路由）；
  端口从运行环境上下文取，不要写死。
- **看构建产物**：`client.js` 开头有 banner（版本、许可证）；`npm run check` 会验证它与 `src/` 一致。
- **看端到端证据**：`npm run test:e2e -- --keep` 后，`.tmp/e2e-artifacts/<suite>/report.json` 含每一步结果、
  页面事实、截图与控制台错误。

## 5. 常见陷阱（改位置/层叠前必读）

1. `transform` / `filter` / `backdrop-filter` 会让元素成为 `position: fixed` 后代的包含块，**禁止**在 composer 区域使用。
2. 「背景之上、所有 UI 之下」= 容器 `isolation: isolate` + 伪元素 `z-index: -1`；`isolation` 不会创建 fixed 包含块。
3. 不要给 app 已算好的布局盒加 `padding` / `margin`：会被座位裁剪吃掉内容。背景条是绝对定位、零布局影响。
4. `MutationObserver` 看不到纯样式尺寸变化；composer 包装层另有 `ResizeObserver`。
5. 层叠/裁剪类改动必须用真实 DOM 量，不要用自摆假体验证。
6. 主题 token 发布在 `body` 上（`--dsw-alias-*`），不是 `html`。
7. 卸载时要把 `<html>` 属性、内联变量、注入节点、测量样式表与待执行 rAF 一起清理（`teardownVisuals()`）。

## 6. 新增一行设置的步骤

1. `src/constants.js`：加存储键（如 `FOO_KEY`）与默认值；
2. `src/i18n.js`：加 `zh` / `en` 的标题与描述（键名 camelCase）；
3. `src/rows.js`：写一个行组件（复用 `Row` / `SwitchRow` / `ColorRow` / `ActiveSliderRow`）；
4. `src/rows.js`：把组件加入 `BACKGROUND_ROWS` 或 `UI_GROUPS`（按标签页/卡片分组）；
5. 若引入新状态：在 `src/storage.js` 加读写，或建 `createSwitch` / `createColorSetting` 实例；
6. `npm run format && npm run build && npm run check && npm run test:unit`；
7. 在 `test/e2e/steps/` 的相关套件里加断言（至少验证行出现、控件类型、写入设置后 DOM/存储变化）。

## 7. 新增宿主路由的步骤

1. `host/constants.js` 加路径；
2. `host/routes.js` 写处理器（方法校验、错误响应、必要时缓存）并加入返回对象；
3. `index.js` 用 `ctx.effect(() => ctx.webServer.register(...))` 注册；
4. `src/constants.js` 镜像 URL；
5. `test/unit/routes.test.mjs` 覆盖成功与失败路径；
6. 涉及副作用的写操作必须加 CSRF 防护（参考 `FOLDER_HEADER` 的自定义头方案）。

## 8. 发布

见 [PUBLISHING.md](PUBLISHING.md)。

## 相关文档

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [TESTING.md](TESTING.md)
- [CONVENTIONS.md](CONVENTIONS.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
