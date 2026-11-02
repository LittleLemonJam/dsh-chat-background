# 故障排查

> 常见问题的现象、原因与处理方式。按「先确认插件加载 → 再看功能 → 最后看开发环境」的顺序排查。
> 相关：[README](../README.md) · [架构说明](ARCHITECTURE.md) · [测试指南](TESTING.md)

## 1. 一眼判断插件是否加载

| 检查     | 方法                                                                              | 正常结果                                   |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| 宿主半   | 浏览器打开 `http://127.0.0.1:<端口>/chat-backgrounds/health`                      | `200` + JSON（含插件版本、限制与栅栏状态） |
| 宿主路由 | `/chat-backgrounds/list`                                                          | `200` + 图片清单（文件夹路径已脱敏为 `~`） |
| 浏览器半 | DevTools 执行 `document.documentElement.hasAttribute('data-dsh-chat-background')` | 选了背景时为 `true`                        |
| 样式表   | DevTools 查 `style[data-plugin-css="dsh-chat-background/background.css"]`         | 存在                                       |
| 设置页   | 设置 → 页面设置                                                                   | 背景 6 行 + UI 3 组卡片                    |

`/chat-backgrounds/*` 是本地路由但带请求栅栏（详见 SECURITY.md）；非回环访问默认 `403`。未知路径返回 `404`。
若返回 `404`，说明宿主半没有加载。若返回 `403`，多为 Host/反代问题，见 §8。

## 2. 设置页没有「页面设置」分区

| 可能原因            | 处理                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 插件未安装 / 未启用 | 插件 → 已安装 里确认 `dsh-chat-background` 已启用；检查 profile 的 `dsh.profile.bundles` 与 `cordis.patch.yml` 的 insert 行 |
| 安装后没有重启      | 宿主半只在启动时加载：**完全退出**桌面端（含托盘）再打开                                                                    |
| bundle 加载失败     | 看设置 → 插件列表里的错误；或用 `dsh --profile desktop --dump-config` 检查组合结果                                          |

## 3. 选了背景但界面没变化

| 可能原因               | 处理                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| 图片文件名不存在       | 在设置里点「重新扫描」后重新选择；`localStorage` 里残留的旧名字会在下拉框显示 `(missing)` |
| 背景文件夹为空         | 把图片放进 `~/.dsh/backgrounds/`（或 `DSH_BACKGROUNDS_DIR` 指向的目录）后重新扫描         |
| 图片格式不支持         | 支持 png / apng / jpg / jpeg / webp / gif / avif / bmp / svg                              |
| 宿主半 404             | 见 §1；检查 `DSH_BACKGROUNDS_DIR` 是否正确                                                |
| 同名图片覆盖后仍是旧图 | 图片响应使用 `must-revalidate`，刷新页面即可                                              |

## 4. 背景条不出现 / 位置不对

- 出现条件：**有背景图** + 「输入栏下方背景条」开关为开 + 页面存在用量数据行（全新会话、没有用量时不出现）。
- 位置由「输入卡片 + 用量行」两个锚点测量得来；DSH 升级改变 composer 结构时可能失效。
- 自查：DevTools 执行
  `document.querySelector('[data-dsh-chat-strip]')?.getBoundingClientRect()`，
  与 `[data-slot="conversation.composer.bar"] > * [data-composer-dock]` 的矩形对比。
- 若宽度等于整个 composer 包装层而不是输入卡片，通常是 `findInputCard` 没找到卡片（见 `src/strip.js`），
  需要按新 DOM 重新校准。

## 5. 进度条一直是 100% / 不动

- 空闲（没有任务清单、也没有运行中的回合）时进度条**隐藏**；运行中或存在任务清单时才会出现。
- agent 运行时若没有维护 todo 清单，走步数估算：运行中最高 92%，结束后回到 100%。
- 若运行中仍显示 100%，检查 DSH 版本是否还提供 `todos` / `sessionStats` 投影（插件对未知投影做了容错）。
- 关闭开关后进度条消失；刷新后恢复上次状态。

## 6. Token 行显示 `…` 或 `0`

| 现象         | 原因 / 处理                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 一直 `…`     | 宿主 `/chat-backgrounds/token-total` 返回非 200，或页面还没拿到第一次响应；等 60 秒或刷新                                                   |
| 显示 `0`     | 还没有任何会话投影缓存（全新安装），或缓存目录被清理过                                                                                      |
| 数字比预期小 | 只统计磁盘上仍存在的 `session_projcache/sessions/*.json`；缓存被清理的会话统计不到；单个投影文件超过 8 MB（`MAX_PROJECTION_BYTES`）会被跳过 |
| 位置不对     | 依赖 `[class*="settingsArea"]` 锚点；DSH 改侧栏结构后会重新插入失败，需要校准                                                               |

## 2.5 图片滚轮缩放

- 聊天图片：点开灯箱后 **滚轮缩放**（以光标为锚点，0.4×–8×），**双击**还原；
- 右侧栏图片预览：普通滚轮等价于组件自带的 **Ctrl+滚轮** 缩放，刷新后保持缩放偏好；
- 这是内置手势，没有设置开关；内联缩略图不参与，避免误缩放页面。

## 2.6 用诊断对象看「哪个锚点没找到」

DevTools 执行：

```js
window.__dshcb.diagnostics()
```

返回背景是否生效、被测量的不透明容器数、背景条/输入卡片/用量行分别用的哪个锚点（`data-composer-card` /
stable-hooks / wording-fallback）、进度条是否空闲、Token 行状态与最近一次列表/Token 请求的 `source`。
只剩一个字段异常时，通常就是该功能在 DSH 升级后失效的位置。

## 7. 改代码不生效

| 改了什么                                    | 生效条件                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/`（浏览器半）                          | 必须 `npm run build` 并同步 `client.js` 到已安装目录；客户端轮询产物后热替换 |
| `host/`、`index.js`                         | 需要重启桌面端（或 DSH HMR 触发 profile 重新组合）                           |
| `package.json` 的 `dsh.client`/`dsh.bundle` | 需要重启                                                                     |
| 改了工作区但没同步安装目录                  | 检查已安装目录里的文件 mtime；用 `npm run check` 确认产物新鲜度              |

## 8. 开发/测试环境问题

| 现象                              | 处理                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run test:e2e` 找不到 DSH CLI | 传 `--dsh <dsh.cmd 路径>` 或设置 `DSH_CLI`        |
| 找不到浏览器                      | 传 `--browser <exe>` 或设置 `DSH_E2E_BROWSER`     |
| 端到端套件超时                    | 用 `--suite 01-smoke --keep` 看页面实际状态与截图 |
| `client.js is stale`              | `npm run build` 后重新提交                        |
| 格式检查失败                      | `npm run format` 后重新提交                       |

## 8.5 反向代理 / 远程访问（请求栅栏 403）

五条本地路由会校验 `Host`/`Origin`/`Sec-Fetch-Site`（防 DNS rebinding）。如果通过非回环地址访问 Web GUI，
图片与 Token 行会 `403`。设置 `DSH_CHAT_BACKGROUND_ALLOWED_HOSTS=<你的主机名>[,...]` 后重启；只有在可信代理下才用 `*`。
这是有意为之的默认拒绝，不表示插件损坏。

## 9. 收集报障信息

提 Issue 时请附：

- DSH 版本（设置 → 关于）与插件版本（设置 → 插件列表）；
- 现象截图；
- DevTools 控制台错误（如果有）；
- `window.__dshcb.diagnostics()` 的 JSON（去掉个人信息）与 `/chat-backgrounds/health` 的响应；
- `document.documentElement.getAttribute('data-dsh-chat-background')` 与三个背景 CSS 变量的值；
- `/chat-backgrounds/list` 的响应（去掉个人路径）。

## 相关文档

- [README](../README.md)
- [DEVELOPMENT.md](DEVELOPMENT.md)
- [TESTING.md](TESTING.md)
