# 发布检查清单

[English](RELEASE.md) · 简体中文

本地仓库是开发源。发布 npm 或把仓库公开是单独的发布决定；没有明确批准，不要移除
`private` 或发布。

## 分发模式

这是**手动打补丁安装**，不是插件市场包。市场索引无法表达宿主补丁要求，`engines.dsh`
也无法区分打过补丁的宿主和原生宿主。不要为本包生成或发布市场索引；分发 checkout 或
tarball 时，必须同时带上 [`docs/INSTALL.zh-CN.md`](INSTALL.zh-CN.md) 的补丁说明。

## 发布前

- [ ] README / README.zh-CN 描述当前行为。
- [ ] `docs/ARCHITECTURE.zh-CN.md` 与代码一致（锚点、严格拒绝工具组切边、tier、提醒、投影）。
- [ ] `docs/INSTALL.zh-CN.md` 适用于目标 DSH beta 版本。
- [ ] 许可证和包元数据正确。
- [ ] 醒目说明宿主补丁要求。

## 公开仓库准备

仓库元数据、Release 资产、说明模板和发布顺序见
[`docs/GITHUB.zh-CN.md`](GITHUB.zh-CN.md)。社区目录条目草稿见
[`docs/AWESOME.zh-CN.md`](AWESOME.zh-CN.md)；宿主补丁仍存在时不要提交。

- [ ] 从 `package.json` 移除 `"private": true`。
- [ ] 添加公开 URL 对应的 `repository`、`homepage`、`bugs` 字段。
- [ ] 在 `LICENSE` 中补最终作者/版权行。
- [ ] 决定宿主补丁放在本仓库还是单独兼容分支；写清支持的 DSH 版本。

## 验证

- [ ] `npm install`
- [ ] `npm run build`（host + client，生成声明）
- [ ] `npm run check`
- [ ] `npm run prepare:release`（把补丁复制到被忽略的 `release/` 目录）
- [ ] `npm run check:patch`（patches/ 与 release/ 的补丁为 LF 且逐字节一致）
- [ ] `npm test`（全部通过）
- [ ] `npm pack --dry-run` 并检查 tarball：
  - 包含 `lib/`、`lib/client.js`、`cordis.patch.yml`、`patches/`、
    `docs/ARCHITECTURE.zh-CN.md`、`docs/INSTALL.zh-CN.md`、`docs/PROMPTS.zh-CN.md`、双语 README、LICENSE；
  - 不包含 `overlay/`、`logs/`、`tests/`、`src/`、`scripts/`。
  - tarball 内的 `patches/dsh-model-message-decoration.patch` 为 LF；
- [ ] 把打包后的 tarball 安装到**已打补丁**的 DSH checkout 上的干净 profile，验证面板、
      工具、锚点、提醒和审计。
- [ ] 验证补丁能应用到干净的 0.2.1-rc.2 checkout，宿主能重建，并且在未打补丁的宿主上
      插件会显式失败。
- [ ] 验证卸载/重装，以及已有会话的 replay。

## Git 与 npm

- [ ] 仅在发布时创建公开仓库。
- [ ] 提交当前树；不要提交本机 overlay。
- [ ] 推送到选定远端；不要对已有公开仓库 force-push。
- [ ] 只有明确批准后才发布：`npm publish`。
- [ ] 验证发布的 tarball 后再打 tag。
