# 贡献指南

感谢参与 `dsh-chat-background`（DSH 聊天背景插件）。本文档说明环境、流程与提交规范；修改代码前请先读
[开发指南](docs/DEVELOPMENT.md) 与 [格式规范](docs/CONVENTIONS.md)。

## 1. 环境要求

| 依赖                    | 版本                     | 说明                                         |
| ----------------------- | ------------------------ | -------------------------------------------- |
| Node.js                 | `^22.19.0 \|\| >=24.0.0` | 与插件 `engines.node` 一致                   |
| npm                     | 随 Node 附带             | 用于安装开发依赖与运行脚本                   |
| DeepSeek Harness 桌面端 | `>= 0.2.1-rc.3`          | 端到端测试需要；仅跑单元测试与静态检查不需要 |
| Chromium 内核浏览器     | Edge / Chrome 任一       | 端到端测试使用；路径可用环境变量覆盖         |

```bash
npm install          # 安装 esbuild / prettier
npm run build        # 由 src/ 生成 client.js
npm run check        # 静态检查（含构建产物新鲜度）
npm run test:unit    # 单元测试
```

## 2. 分支与提交

- 从 `main` 切分支：`feat/<简述>`、`fix/<简述>`、`docs/<简述>`、`chore/<简述>`。
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：
  `type(scope): subject`，例如 `fix(host): reject malformed image names`。
  - 常用 `type`：`feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`build`、`ci`。
  - `scope` 取模块名：`host`、`client`、`styles`、`e2e`、`docs`、`repo`。
- 一个提交只做一件事；格式化、构建产物与源码改动分开提交时，先提交源码再提交 `client.js`。
- 不直接向 `main` 推送；通过 Pull Request 合并。

## 3. 修改代码的流程

1. 改 `src/`（浏览器半）或 `host/`、`index.js`（宿主半）；**不要直接改 `client.js`**，它是构建产物。
2. `npm run build` 重新生成 `client.js` 并一起提交。
3. `npm run format` 统一格式；`npm run check` 必须全绿。
4. `npm run test:unit` 必须全绿；改到界面行为时再跑 `npm run test:e2e`（需要本机 DSH 安装）。
5. 在 Pull Request 里说明：改了什么、为什么、如何验证。涉及界面/层叠的改动请附截图或实测数据。

## 4. 代码与文档格式

- 全部规则见 [docs/CONVENTIONS.md](docs/CONVENTIONS.md)；格式由 Prettier 与静态检查强制执行。
- 用户可见文案必须同时提供 `zh` 与 `en`（`src/i18n.js` 与 `locale/`），键集合必须完全一致。
- 注释与 JSDoc 使用英文，面向用户的文档使用中文（英文 README 单独维护）。

## 5. 审查

- 每个面向 `main` 的 Pull Request 至少经过一次独立审查（可为本仓库的审查子智能体或人类维护者）。
- 审查关注：正确性与边界、层叠/布局副作用、DSH 版本兼容、格式与文档一致性。

## 6. 发布

- 版本号遵循 SemVer；发布步骤见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。
- 发布前必须：`npm run verify`（格式 + 构建 + 检查 + 单元测试）全绿，CHANGELOG 已更新。

## 7. 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
