# 发布指南

> 把插件发布到 GitHub、npm 和 DSH 插件市场（DSH Plugin Hub）的流程。

## 1. 发布前检查

```bash
npm run verify        # 格式 + 构建一致性 + 静态检查 + 单元测试
npm run test:e2e      # 11 个端到端套件（需要本机 DSH）
npm pack --dry-run    # 确认 tarball 内容
```

- `package.json` / `client.js` banner / `CHANGELOG.md` 的版本必须一致；
- `README.md` 的安装命令与实际包名一致；
- 不提交 `_scratch/`、`.tmp/`、`node_modules/`、任何个人路径或凭据。

## 2. GitHub 发布

### 2.1 历史清洗（首次开源必做）

如果仓库曾作为私有开发仓库使用，旧提交里可能包含个人路径、内部报告或测试产物。首次公开前：

- 用 `git grep -nE "C:\\\\Users|/Users/|E:/deepseek|docs/handoff" $(git rev-list --all)` 检查**全部历史**；
- 推荐直接 `rm -rf .git && git init -b main`，把当前工作区作为**单个初始提交**发布；
- 删除旧 tag（如 `git tag -d v1.2.0`），只保留要发布的版本；
- 复查 `git log --oneline` 与 `git ls-files`，确认没有个人文件后再推送。

当前仓库已按此方式重建为单提交的 1.0.0 起点，当前发布版本 1.1.0。

### 2.2 首次创建仓库

1. 在 GitHub 新建公开仓库 `dsh-chat-background`（默认分支 `main`）；
2. 推送代码与 `v1.1.0` 标签；
3. 仓库 **About** 填写简介：
   - 描述：`给 DeepSeek Harness 桌面端换背景：背景图/轮换分组/三栏遮罩/输入栏背景条/任务进度条/Token 用量`；
   - 网站：留空或填仓库地址；
   - Topics：`dsh-plugin`、`deepseek-harness`、`dsh`、`background`、`wallpaper`、`theme`、`cordis`；
4. README 必须包含可复制的安装命令：

   ```bash
   dsh plugin --profile desktop add github:LittleLemonJam/dsh-chat-background
   ```

`dsh-plugin` topic 是插件市场自动扫描的识别标记，必须添加。

### 2.3 Release

推送 `v*` 标签会触发 `.github/workflows/release.yml`：校验标签与 `package.json` 版本、跑 `npm run verify`、
生成 npm tarball 并创建 GitHub Release。发布后在 Release 中附上主要更新内容即可。

```bash
git tag v1.1.0
git push origin main --tags
```

## 3. npm 发布

`1.1.0` 已发布到 npm，`dsh plugin --profile desktop add dsh-chat-background` 可直接安装。
发新版本时：

```bash
npm whoami                      # 确认是维护者账号 lemonjam
npm publish --access public     # 需要带 bypass 2FA 的 granular token
```

验证：

```bash
npm view dsh-chat-background version   # 应等于当前版本号
dsh plugin --profile desktop add dsh-chat-background@1.1.0
```

> npm 页面上的 README 是发布时 tarball 的快照，发布后再改 README 不会回写 npm 页面，
> 下次发版时才会同步；以 GitHub 仓库的 README 为准。

### 3.1 pnpm 观察期（minimumReleaseAge）

DSH 插件页的安装走 profile 里的 pnpm；pnpm 11 默认 `minimumReleaseAge = 1440` 分钟，即
**npm 发布后 24 小时**内，`dsh plugin add dsh-chat-background`（不带版本）不会解析到最新版，
而是装上满足观察期的最新旧版本。实测：1.1.0 发布约 12 小时后，在隔离 profile 里安装，
`dsh-chat-background` 装到的是 1.0.0。

- 观察期从 npm registry 的发布时间算（`npm view dsh-chat-background time --json`）；
- 精确版本 `dsh plugin add dsh-chat-background@1.1.0` **不受**该限制，可以立即安装
  （DSH 安装界面也会提示“卸载后安装精确版本”）；
- 本机也可以在 profile 的 `pnpm-workspace.yaml` 里用
  `minimumReleaseAgeExclude: ["dsh-chat-background@1.1.0"]` 放行单个版本，或改
  `minimumReleaseAge`（不推荐）；
- 插件市场的一键安装是不带版本的，因此发布后 24 小时内用户一键安装拿到的仍是旧版，
  这是 pnpm 供应链安全策略的预期行为，不是发布失败。

### 3.2 发布后验证（每次发版必做）

1. 记录发布时间并确认观察期：
   ```bash
   node scripts/release-check.mjs
   ```
   输出当前版本的 `published`、`age`、`due`（观察期结束时间）和是否已通过。
2. 在 `due` 时间之后（建议 +10 分钟）安排一次会话提醒（`schedule_create`），到点执行：
   ```bash
   DSH_CLI="<dsh.cmd 路径>" node scripts/release-check.mjs --install
   ```
   该命令会在隔离 profile 里执行一次与插件页相同的“不带版本”安装：
   - 输出 `unpinned install: <版本> (latest)` 且退出码 0 → 用户已能一键装到新版；
   - 仍显示旧版本 → 观察期未到或 profile 配了 exclude，记录剩余时间并稍后再查。
3. 把结果回报后再结束本次发版；确认可用后，市场/插件页的一键安装即视为验证通过。

## 4. 提交 DSH 插件市场

DSH 0.2.x 的插件市场会扫描 GitHub 上的公开 DSH 插件；收录要求：

1. GitHub **公开仓库**；
2. 仓库 Topics 含 `dsh-plugin`；
3. README 含安装命令；
4. 仓库导出符合规范的 `apply(ctx)` 插件（本项目 `index.js` + `cordis.patch.yml` 已满足）；
5. 不冒充官方项目。

满足后到 **[dsh-plugin.org 提交插件](https://dsh-plugin.org/zh/submit)** 填写仓库地址、名称、简介与分类
（建议 `界面体验` / `Themes & Appearance`），等待自动扫描与人工确认。

收录后市场会定期同步仓库的 Star、更新时间和 README；后续发版只需保持仓库与 Release 规范，无需重复提交。
也可以同时提交到 `awesome-dsh-plugin` 等社区目录，按各仓库模板提 PR。

## 5. 版本策略

- **PATCH**：修复、文档、内部重构；
- **MINOR**：新增功能、新增设置项、新增存储键；
- **MAJOR**：删除/重命名存储键、改变默认行为或最低 DSH 版本。

## 6. 回滚

- GitHub Release 保留历史标签；用户可安装指定版本或旧 commit；
- npm 发布 72 小时内可 unpublish（或发布修复版本）；
- 存储键只增不减，旧版本会忽略新键，新版本会忽略旧键，回滚不需要迁移。

## 相关文档

- [DEVELOPMENT.md](DEVELOPMENT.md)
- [TESTING.md](TESTING.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CHANGELOG.md](../CHANGELOG.md)
