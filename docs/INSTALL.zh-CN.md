# 安装（需要宿主补丁）

[English](INSTALL.md) · 简体中文

本包只支持**手动安装**，不是可直接上架、装上即用的插件市场包：它需要给 DSH 宿主打一个本地补丁。在 `modelMessageDecoration` 接缝进入上游之前，不要把它列进插件市场。

## 为什么必须打补丁

原生 DSH 没有“修改发给模型的消息”的接缝。本插件需要这个接缝来显示 `⟦p<number>⟧` 锚点，并让 token meter 统计同一份装饰文本。补丁增加一个很小的 `modelMessageDecoration` 服务，并在 agent loop 与 token meter 中调用它。没有补丁，插件无法正确显示锚点；只安装插件不够。

补丁位于 [`patches/dsh-model-message-decoration.patch`](../patches/dsh-model-message-decoration.patch)，契约见 [`patches/README.zh-CN.md`](../patches/README.zh-CN.md)。

## 开始之前

- 使用**干净的 DSH 0.2.1-rc.2 checkout**。不要给日常使用的 checkout 打补丁，除非你能安全地重建它。
- 使用单独的测试 profile（例如 `web-decay`），避免补丁影响正常 profile。
- 准备 Git、Node.js >= 22.19、pnpm。
- 打补丁前先建分支或提交，保证一条命令可以回滚。
- 在插件目录运行 `npm run check:patch`。宿主补丁必须是 LF；CRLF 副本会让
  `git apply --check` 在 LF checkout 上把每个 hunk 都判为不匹配。

## 1. 检查宿主版本

```bash
cd /path/to/deepseek-harness
git status --short
node -p "require('./package.json').version"
```

预期版本是 `0.2.1-rc.2`。版本不同，补丁可能无法应用；请 rebase 或使用匹配的 beta 版本。

## 2. 应用补丁

```bash
git apply --check /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
git apply /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
git diff --stat
```

diff 应显示消息装饰服务、agent-loop 调用点、token meter 改动。如果 `git apply --check` 失败，立即停止，不要强行应用；先用 `npm run check:patch` 排除行尾问题，否则再按 checkout 与补丁基线不一致处理。

### Windows PowerShell

```powershell
cd G:\develop\ai-projects\deepseek-harness
git apply --check G:\develop\ai-projects\dsh-context-decay\patches\dsh-model-message-decoration.patch
git apply G:\develop\ai-projects\dsh-context-decay\patches\dsh-model-message-decoration.patch
git diff --stat
```

### 确认接缝存在

```bash
grep -n "ModelMessageDecorationService" packages/core/agent-loop/src/message-decoration.ts
grep -n "modelMessageDecoration" packages/core/agent-loop/src/agent.ts
```

两条命令都必须有匹配。没有匹配说明补丁没应用成功。

## 3. 重建宿主

```bash
pnpm install
pnpm build
```

重建后的宿主才会暴露接缝。只安装插件而不重建，系统提示和工具可能可见，但锚点与压力统计不会正确。

如果从源码 checkout 运行，使用该 checkout 的 CLI：

```bash
pnpm dsh --profile web-decay ...
```

如果 `dsh` 已全局安装，直接用 `dsh` 即可。

## 4. 构建或打包插件

在本仓库中：

```bash
npm install
npm run build
npm test
```

`lib/` 会包含宿主入口、声明文件和客户端 bundle。如果与 DSH checkout 并排构建，可设置 `DSH_HARNESS_ROOT`，不必本地安装 TypeScript。

如果不想让用户构建，可以打 tarball：

```bash
npm pack
# 生成 dsh-context-decay-0.1.0.tgz
```

tarball 包含 `lib/`、`cordis.patch.yml`、`patches/` 和文档。用户用下一节的命令安装。

## 5. 安装到 profile

从插件 checkout 安装：

```bash
dsh plugin --profile web-decay add /path/to/dsh-context-decay
```

或从 tarball 安装：

```bash
dsh plugin --profile web-decay add ./dsh-context-decay-0.1.0.tgz
```

包声明了 `dsh.bundle.patch`，所以 `dsh plugin` 会记录该 bundle 并应用 `cordis.patch.yml`：

- 关闭官方自动压缩（`compaction-basic.auto: false`）；
- 保留手动 `/compact` 命令（`command-compact`）；
- 在存在对应行时关闭 `tool-result-pruner`、`image-offload`；
- 插入 `context-decay`。

`/compact` 是手动宿主兜底：它写官方 checkpoint，不是 context-decay 块；插件的面板和
位置 replay 会把它当普通历史。只在会话已经大到无法正常请求时使用。

如果 profile 没有其中某个可选行，安装前从 `cordis.patch.yml` 删除对应块；patch 指向不存在的 row 可能在组合阶段失败。

### 带 preset 的 profile

bundle patch 只作用于 host 层行。内置 preset 会保留自己的 realm-local
`compaction-basic`（自动压缩开启）和 `tool-result-pruner`；使用该 preset 的 profile
仍可能和 context-decay 同时压缩。请移除该 preset 的 `compaction` 组，或把其中的
`compaction-basic` 设为 `config: { auto: false }` 并关闭 `tool-result-pruner`。
插件无法从 bundle patch 修改 preset 内部的行。

## 6. 启动并验证

```bash
dsh web --profile web-decay
```

验证：

1. 系统提示包含 `Context decay is enabled for this session.`
2. 新会话的模型可见消息显示 `⟦p<number>⟧` 前缀。
3. `compress`、`drop` 工具可用。
4. 侧栏面板显示压力、块、位置和请求计数。
5. 如果启用 `audit`，`$DSH_HOME/context-decay/audit.jsonl` 有记录。

插件只由安装它的 profile 或 `--patch` overlay 挂载。另一个 home/profile 启动的日常实例不会继承插件，侧栏不会出现面板，模型也没有工具。`compress`、`drop` 是模型工具，不是侧栏按钮；模型调用时才在对话里出现，侧栏只显示面板。

如果使用自定义测试启动器，先确认启动命令带着同一个 `--patch` overlay（或 profile 自己的 `cordis.patch.yml` 包含插入行），再排查插件。`--patch` 是 dsh 的全局参数，必须放在 `--port` 等 web app 参数之前；放在 `--port` 后面会被当成 web app 参数并报 `unknown option '--patch'`。

如果没有锚点，先复查第 2、3 步，再排查插件。

## 更新或回滚宿主

升级 DSH 时，在新 checkout 上重新应用或 rebase 补丁，重建后重启。保持补丁版本与宿主版本匹配。

完全移除：

```bash
dsh plugin --profile web-decay remove dsh-context-decay
git -C /path/to/deepseek-harness apply -R /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
pnpm -C /path/to/deepseek-harness build
```

先移除插件，再回滚补丁；否则模型请求里仍带装饰，而未打补丁的宿主不认识它们。已有摘要块会留在会话日志中；移除插件不会改写它们。

## 排查

| 现象 | 原因 / 处理 |
|---|---|
| `git apply --check` 失败 | DSH 版本不对、checkout 有本地改动，或补丁是 CRLF 行尾；先运行 `npm run check:patch`，仍失败再在干净 checkout 上 rebase 补丁。 |
| `git apply --check` 每个 hunk 都失败 | 补丁文件是 CRLF 行尾；使用 LF 副本并运行 `npm run check:patch`。 |
| preset 里仍在自动压缩 | 该 preset 自带 `compaction-basic`；移除或关闭 preset 的 compaction 组。 |
| 消息没有锚点 | 补丁未应用或宿主未重建；复查第 2、3 步。 |
| `modelMessageDecoration` 不可用 | 缺少接缝；应用补丁。 |
| 插件加载了但没效果 | `enabled` 为 false，或 profile patch 没有插入行。 |
| 官方自动压缩仍在运行 | `compaction-basic.auto` 不是 `false`；修正 bundle patch。 |
| `/compact` 不可用 | `command-compact` 被禁用或 profile 缺该行。 |
| 客户端面板缺失 | profile 缺少客户端 UI 包，或 `lib/client.js` 不存在。 |
| 侧栏没有 Context decay，工具也不可用 | 当前实例没有挂载插件：profile/home 不对、缺少 `--patch` overlay，或 profile patch 没有插入行。重启安装了插件的实例；另一个日常实例不会继承插件。 |
| `compress` / `drop` 在侧栏看不到 | 它们是模型工具，不是侧栏按钮；模型调用时才在对话里出现。侧栏只显示面板。 |
| `compress` 拒绝旧 span | span 包含当前回合或工具组；选择组外边界。 |

## 分发说明

本包以手动打补丁的 checkout 或 tarball 分发，不作为市场 bundle；manifest 保持
`"private": true`，发布 npm 是单独的发布决定。市场索引无法表达“宿主补丁”这个前提，
`engines.dsh` 也无法区分打过补丁的宿主和原生宿主。如果接缝被上游接受，补丁步骤可以消失，
届时再考虑正常上架。
