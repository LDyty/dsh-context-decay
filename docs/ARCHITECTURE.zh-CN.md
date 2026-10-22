# 架构说明

[English](ARCHITECTURE.md) · 简体中文

本文描述插件的实现。

## 1. 宿主接缝

原生 DeepSeek Harness 不允许插件在请求边界装饰模型可见消息。本地补丁
`patches/dsh-model-message-decoration.patch` 增加 `modelMessageDecoration` 服务，
并在三处应用装饰结果：

- agent loop：消息交给模型适配器之前；
- token meter：压力统计包含同一份装饰；
- 请求 payload：模型和 meter 看到的文本完全一致。

插件向该服务注册装饰提供者。如果接缝不存在，插件显式失败，而不是发送无法从
日志重建锚点的消息。

客户端是一个 lazy-CJS bundle（`lib/client.js`），通过 `dsh.client` 声明，由宿主
module table 加载，并贡献侧栏面板。

## 2. 位置状态

`src/state.ts` 把会话日志 replay 成 `DecayState`：

- 每个 surface 节点有稳定的 `seq`、可选 `messageId`、可选 `left`/`right` 锚点 id、
  token 估算和可选块记录；
- `append` 分配位置；`replace` 把区间变成摘要块；
- 位置是 **id，不是计数**：被压缩区间的 id 回到 free list，可被新消息复用；
  数值大小不代表消息顺序；
- `nextPosition`、`free`、`reusedPositions` 都从日志重建，重启后状态一致。

块记录包含 `left`、`right`（未闭合为 `null`）、tier、摘要文本、topic、token 数和
来源事件 seqs。

## 3. 装饰与渲染

`src/render.ts` 为每条模型可见消息计算一个装饰：

- 所有可寻址节点加前缀 `⟦p<left>⟧ `；
- 如果块右边界没有后续可见节点负责打印，则加后缀 ` ⟦p<right>⟧`；
- assistant 消息 **只**通过改写已有 text 块来加锚点。只有工具调用、没有文本的
  assistant 回合没有锚点；这是刻意的，因为改写其按索引对齐的内容可能破坏原生
  replay 签名；
- tool call 和 tool result 保持原生 id 与顺序。

装饰不修改持久内容，也不从消息文本解析锚点。消息正文里看起来像 `⟦p12⟧` 的文本
只是内容。assistant 回复开头连续复制的锚点会在构建请求时和落盘前各剥离一次；
落盘清理来自 `modelMessageDecoration` 服务的 `sanitizeAssistantMessage` 钩子。

## 4. 压缩事务

`compress` 接受 `spans: [{from, to, summary, topic?}]`；`from`/`to` 是锚点文本，
如 `"⟦p12⟧"`（裸 `"p12"` 和整数 `12` 也接受）。

写入任何事件之前先做校验：

1. 解析并规范化每个 span；摘要里的 `⟦p<n>⟧` 会被剥离；
2. 用节点身份（锚点 id）解析 `from`、`to`，绝不按数值排序；
3. 拒绝包含当前回合的 span；唯一例外是 "to" 为当前回合第一条可见锚点：保留无锚点前缀并把 span 收到最后一个可压缩节点；
4. 拒绝落在 assistant tool-call 组内部的边界。同一 tool-call 的全部结果必须同段；
   插件不会自动扩边；
5. 拒绝重叠 span；执行数量、摘要长度限制；
6. 可选执行 miss/payback guard。

中间必须保留的内容不要覆盖：围绕它拆成多个不重叠的 span，让 live gap 保持可见。
一次调用带上所有已用完的段；分开多次调用会让前缀缓存重复失效。

成功压缩写入：

```text
compaction/start
compaction/summary
user/message（摘要，通过 replace）
compaction/end
```

Replay 把被替换的区间变成块。对已有块再压缩会增加 tier 并合并边界；摘要仍然
必须自包含。

`drop` 要求精确的 live pair，删除整个块，无墓碑；释放的位置 id 回到 free list。

## 5. 压力与提醒

`src/window.ts` 解析有效窗口：

```text
effective = total context window - reserved output tokens
```

总窗口来自路由/请求上下文；预留来自最新请求 header，其次 config，再次默认值。
模型看到的压力是有效窗口占比；面板同时显示总窗口和预留，并额外显示总窗口占用，
便于直接对照内置上下文进度。

`src/prompt.ts` 决定提醒：

- 距上次提醒每增长 `growthTokens` 发一条提醒；
- 提醒类型跟随当前 `warnRatios`（默认 70/81/95%）档位；
- 跨入更高档位立即触发，即使还没到下一个增长步；
- 同一档位每个增长步长重复一次；最高档使用更短的 `criticalGrowthTokens`；
- 只有普通提醒使用回合冷却；压缩导致压力下降时重新基线化增长。

提醒从不调用 `compress`；由模型决定。请求 guard 仍是硬预算保护。

bundle patch 保留官方后端但设置 `auto: false`，并保留 `/compact` 命令。手动
`/compact` 写官方 checkpoint；replay 把它当普通历史，不是 context-decay 块。
它是应急的宿主兜底，不是一个额外的 tier。

## 6. 投影、面板与审计

`src/projection.ts` 注册 `contextDecay` session projection（版本 5），把按 session
隔离的宿主运行时快照（压力、提醒、请求）与 replay 的块账本合并。checkpoint 记录
所属 session id，所以每个面板只读自己 session 的运行时事实；恢复会话在首次读取时
自动补齐。客户端面板读取该投影，不依赖内置 context-pressure 组件。位置空间把 replay
的 surface 顺序反转渲染：上下文中最新节点在最上面，最早节点在最下面。锚点 id 是身份，
不是显示顺序。

启用 `audit` 时，每个请求/压缩写一行 JSONL 到
`$DSH_HOME/context-decay/audit.jsonl`。审计是可选的，不属于模型可见上下文。

## 7. 不变量

- 锚点来自 replay，不来自文本；
- 当前回合永不被压缩；需要时保留无锚点前缀并收窄 span；
- 一个 tool call 和它的全部结果必须在同一 span；
- span 互不重叠，按身份解析；
- 摘要是有损的，且是唯一存活记录；
- `drop` 删除整个块，绝不删除部分 span；
- 装饰只属于表现层，并且对模型请求和 token meter 完全一致。

## 8. 失败模式

- **缺少宿主接缝**：激活时显式报错。
- **过期或未知锚点**：工具拒绝，并列出当前可见锚点。
- **工具组边界**：工具拒绝并解释组边界。
- **当前回合边界**：工具拒绝并指出受保护回合。
- **成本 guard**：在写事件前拒绝，并建议扩大 span、推迟 `to` 或先 `drop`。
- **投影状态损坏**：投影拒绝持久状态，回退到宿主 replay。
