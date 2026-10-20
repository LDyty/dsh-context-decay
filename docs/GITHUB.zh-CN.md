# GitHub 发布准备

[English](GITHUB.md) · 简体中文

本文是发布仓库的检查清单；它本身不会创建仓库或推送任何东西。

## 仓库标识

| 字段 | 值 |
|---|---|
| 名称 | `dsh-context-decay` |
| 描述 | 面向 DeepSeek Harness 的模型驱动有损上下文衰减。需要打 DSH 宿主补丁，不是装上即用的插件。 |
| Topics | `deepseek-harness`、`dsh`、`dsh-plugin`、`context-compression`、`context-decay`、`compaction`、`llm`、`agent` |
| 默认分支 | `main` |
| 许可证 | MIT |

描述里不要暗示一键安装或市场安装；第一行必须带宿主补丁要求。

## README 首屏

首屏按以下顺序回答：

1. 做什么：模型选段、有损压缩、内联锚点。
2. 怎么装：手动打宿主补丁 + bundle/tarball；链接 `docs/INSTALL.zh-CN.md`。
3. 不是什么：不是市场一键包；不可恢复；不自动压缩。
4. 兼容性：DSH 0.2.1-rc.2 + `modelMessageDecoration` 补丁。
5. 截图：`docs/assets/panel.png`（侧栏面板，含压力、提醒、位置和摘要块）。

不要放“一键安装”徽章，也不要把安装命令单独放出来而不带补丁前提。

## 提交什么

提交源码树和构建后的 `lib/`：

- `src/`、`client/`、`scripts/`、`tests/`；
- `lib/`（让 checkout 无需构建工具链即可安装）；
- `patches/`、`cordis.patch.yml`、`package.json`、`tsconfig.json`；
- `README*`、`LICENSE*`、`docs/`；
- `docs/GITHUB*`、`docs/AWESOME*` 是发布参考文档；会随 tarball 提供，但插件不会加载它们。

不要提交：

- `overlay/`（本机测试 overlay）；
- `logs/`、`node_modules/`、`*.tgz`、编辑器/系统文件；
- 任何会话日志、audit JSONL 或凭据。

首次提交前先构建并跑测试，保证 `lib/` 与 `src/` 一致。

## 版本与发布资产

- 更新 `package.json` 的 `version`；
- tag：`v0.1.0`；
- Release 标题：`dsh-context-decay v0.1.0`（标题不带日期）；
- 附件：
  - `dsh-context-decay-0.1.0.tgz`（`npm pack`）；
  - `dsh-model-message-decoration.patch`；
  - `SHA256SUMS.txt`。

PowerShell 校验和示例：

```powershell
Get-FileHash .\dsh-context-decay-0.1.0.tgz -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLower())  dsh-context-decay-0.1.0.tgz" } |
  Set-Content SHA256SUMS.txt
```

GitHub 自动生成的 source archive 不能代替构建后的 tarball：source archive
没有 `lib/`，需要自己构建。

## Release 说明模板

```markdown
## dsh-context-decay v0.1.0

面向 DeepSeek Harness 的模型驱动有损上下文衰减。

### 环境要求

- DSH 0.2.1-rc.2 checkout，已应用 `patches/dsh-model-message-decoration.patch`
  并重建宿主。
- Node.js >= 22.19。
- Web profile。

**这是手动打补丁安装，不是市场一键包。** 只安装包而不打补丁、不重建宿主，无法工作。

### 安装

1. 给 DSH checkout 应用 `dsh-model-message-decoration.patch`。
2. 在该 checkout 中执行 `pnpm install && pnpm build`。
3. 安装附件 tarball：
   `dsh plugin --profile web add ./dsh-context-decay-0.1.0.tgz`
4. 启动 `dsh web --profile web`，验证锚点、工具和面板。

完整步骤：`docs/INSTALL.zh-CN.md`。

### 说明

- 摘要是有损的；没有恢复、decompress 或原文搜索。
- 宿主补丁是硬性前提，没有运行时回退。
```

## 不要用 `github:` 安装

`dsh plugin add github:<owner>/dsh-context-decay` 会拉源码并执行 `prepare` 构建。
本包没有自包含 `prepare`，因此不支持该路径。请使用 Release tarball 或本地 checkout。

## 发布后分享

- 在相关项目的 README 和 Release 说明中放仓库链接；
- 在 DSH 社区开 discussion/issue 时，同时写清宿主补丁要求，不要包装成一键插件；
- 如果提交社区目录，使用 `docs/AWESOME.zh-CN.md` 的草稿，把补丁警告放最前。

## 发布顺序（明确批准后）

```bash
git init
git add .
git commit -m "初版"
git branch -M main
git remote add origin <public-url>
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

从 tag 创建 GitHub Release，上传附件并发布说明。不要对已有公开仓库 force-push。
