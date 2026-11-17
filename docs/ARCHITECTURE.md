# 架构说明

本文描述「上下文自觉压缩」插件的实现。技术包名仍是 `dsh-context-decay`。

## 1. 宿主接缝

原生 DeepSeek Harness 不允许插件在请求边界装饰模型可见消息。本地补丁
`patches/dsh-model-message-decoration.patch` 增加 `modelMessageDecoration` 服务，
并在三处应用装饰结果：

- agent loop：消息交给模型适配器之前；
- token meter：压力统计包含同一份装饰；
- 请求 payload：模型和 meter 看到的文本完全一致。

插件向该服务注册装饰提供者。如果接缝不存在，插件显式失败，而不是发送无法从日志重建锚点的消息。

客户端是一个 lazy-CJS bundle（`lib/client.js`），通过 `dsh.client` 声明，由宿主 module table 加载，并贡献侧栏面板。

## 2. 锚点状态与锚点池

`src/state.ts` 把会话日志 replay 成 `DecayState`：

- 每个 surface 节点有稳定的 `seq`、可选 `messageId`、可选 `left`/`right` 锚点句柄、token 估算和可选块记录；
- `append` 分配锚点；`replace` 把区间变成摘要块；
- 锚点是 **4 位英文数字句柄**，不是计数：被压缩区间内部的句柄被回收，可被新消息复用；句柄本身不代表消息顺序；
- 共享边界用 `refs` 引用计数：一个句柄同时作为前一个块的右边界和后一个块的左锚点时，不会被提前回收；
- `allocated`、`free`、`issued`、`anchorPool`、`anchorSeed`、`anchorCounter`、`reusedPositions` 都从日志和确定性种子重建，重启后状态一致。

锚点池是确定性的：

- 以持久 session id 为种子，用 SHA-256 流生成 4 位 `[a-z0-9]` 候选；
- 初始预生成 64 个；可用量低于 16 时扩池 64 个；
- 发放前先查 live/issued 集合，避免重复；
- 回收锚点进入 `free`，新消息优先取回收锚点；没有被复用的预生成锚点留在 `anchorPool`；
- 生成器、池、已发放集合和引用计数都写进 projection checkpoint，所以重放结果稳定。

`createState()` 未收到 session id 时使用固定默认种子（测试/一次性重放）；运行时 `StateCache` 使用 `session.id`，所以不同会话的锚点序列不同。

## 3. 装饰与渲染

`src/render.ts` 为每条模型可见消息计算一个装饰：

- 所有可寻址节点加前缀 `⟦#<left>⟧ `；
- 如果块右边界没有后续可见节点负责打印，则加后缀 ` ⟦#<right>⟧`；
- assistant 消息 **只**通过改写已有 text 块来加锚点。只有工具调用、没有文本的 assistant 回合没有锚点；这是刻意的，因为改写其按索引对齐的内容可能破坏原生 replay 签名；
- tool call 和 tool result 保持原生 id 与顺序。

装饰不修改持久内容，也不从消息文本解析锚点。消息正文里看起来像 `⟦#a8c5⟧` 的文本只是内容。assistant 回复开头连续复制的锚点会在构建请求时和落盘前各剥离一次；落盘清理来自 `modelMessageDecoration` 服务的 `sanitizeAssistantMessage` 钩子。

和旧版 numeric 锚点相比，新锚点文本更长（`⟦#a8c5⟧ ` 含 2 个非 ASCII 字符），token 估算按同一固定启发式计价。

## 4. 压缩事务

`compress` 是唯一工具，接受 `spans: [{from, to, summary, topic?}]`；`from`/`to` 是锚点文本，如 `"⟦#a8c5⟧"`（裸 `"#a8c5"` 或 `"a8c5"` 也接受）。

写入任何事件之前先做校验：

1. 解析并规范化每个 span；摘要里的 `⟦#....⟧` 会被剥离；
2. 用节点身份（锚点句柄）解析 `from`、`to`，绝不按数值排序；
3. 拒绝包含当前回合的 span；唯一例外是 `to` 为当前回合第一条可见锚点：保留无锚点前缀并把 span 收到最后一个可压缩节点；
4. 拒绝落在 assistant tool-call 组内部的边界。同一 tool-call 的全部结果必须同段；插件不会自动扩边；
5. 拒绝重叠 span；执行数量、摘要长度限制；
6. 可选执行 miss/payback guard。

中间必须保留的内容不要覆盖：围绕它拆成多个不重叠的 span，让 live gap 保持可见。一次调用带上所有已用完的段；分开多次调用会让前缀缓存重复失效。

成功压缩写入：

```text
compaction/start
compaction/summary
user/message（摘要，通过 replace）
compaction/end
```

Replay 把被替换的区间变成块。对已有块再压缩会增加 tier 并合并边界；摘要仍然必须自包含。新摘要块保留被压缩区间的第一个左锚点和右边界，内部锚点回到回收池。

## 5. 压力与提醒

`src/window.ts` 解析有效窗口：

```text
effective = total context window - reserved output tokens
```

总窗口来自路由/请求上下文；预留来自最新请求 header，其次 config，再次默认值。模型看到的压力是有效窗口占比；面板同时显示总窗口和预留，并额外显示总窗口占用，便于直接对照内置上下文进度。

`src/prompt.ts` 的提醒机制：

- 间隔固定为有效窗口的 `10%`，不配置分级阈值；
- 有效窗口压力超过约 `33%` 时，每开始新的一轮额外注入一条同类极简提醒；同一轮最多一条；
- 第一次观察建立静默基线；之后距上次提醒达到一个 10% 步长就注入一条；
- 压缩使压力低于上次基线时静默重置基线；
- 每个 step 最多注入一条，提醒本身不调用 `compress`；
- 提醒模板只有「来自自觉压缩工具的提醒：已用 token/有效窗口（百分比）」，规则说明只放在 system prompt 或工具描述里。

请求 guard 仍是硬预算保护；提醒只是建议。

### 5.1 时机与深扫保护

GUIDANCE 建议优先在开始新的一轮时压缩上一轮或更早的已消费历史；阶段/决策点结束、长输出提炼成结论、话题切换、完成交接也适合压缩。检查做到一半、结论还没记录、当前步骤仍依赖精确细节时不适合压缩。

当有效窗口压力超过约 33% 时，`src/tools.ts` 的深扫保护会在写入事件前拒绝以下调用：

- 当前轮次已经产生工具结果或多次 assistant 输出（不是开始新的一轮）；
- 多个 span 中最后一个 span 没有结束在最新安全可压边界，留下了已消费 tail。

提示词告诉模型同一规则：无论一次传几个 span，第一个 span 从已消费边界开始，最后一个 span 结束于最新安全边界，通常是 `"end"` 或当前轮次第一条可见锚点。中间仍然活跃的内容可以作为 gap 保留，但 span 之间不能重叠，也不能切开 assistant tool-call 组。

bundle patch 保留官方后端但设置 `auto: false`，并保留 `/compact` 命令。手动 `/compact` 写官方 checkpoint；replay 把它当普通历史，不是 context-decay 块。它是应急的宿主兜底，不是一个额外的 tier。

## 6. 投影、面板与审计

`src/projection.ts` 注册 `contextDecay` session projection（版本 6），把按 session 隔离的宿主运行时快照（压力、提醒、请求）与 replay 的锚点账本合并。checkpoint 记录所属 session id，所以每个面板只读自己 session 的运行时事实；恢复会话在首次读取时自动补齐。

客户端面板读取该投影，不依赖内置 context-pressure 组件。锚点空间把 replay 的 surface 顺序反转渲染：上下文中最新节点在最上面，最早节点在最下面。面板显示：

- 有效窗口压力与总窗口占用；
- 10% 提醒的最近触发、增长和下次触发；
- 已分配、回收可用、复用次数、可见节点、摘要块、锚点池；
- 最近请求和可选的锚点开销。

启用 `audit` 时，每个请求/压缩写一行 JSONL 到 `$DSH_HOME/context-decay/audit.jsonl`。审计是可选的，不属于模型可见上下文；`first`/`last` 和块配对记录的是锚点句柄，不是正文。

## 7. 不变量

- 锚点来自 replay 和确定性池，不来自文本；
- 同一会话的 live 左锚点不重复；共享右边界按引用计数保留；
- 当前回合永不被压缩；需要时保留无锚点前缀并收窄 span；
- 一个 tool call 和它的全部结果必须在同一 span；
- span 互不重叠，按身份解析；
- 摘要是有损的，且是唯一存活记录；
- 只有 `compress`，没有 `drop` 或恢复路径；
- 装饰只属于表现层，并且对模型请求和 token meter 完全一致。

## 8. 失败模式

- **缺少宿主接缝**：激活时显式报错。
- **过期或未知锚点**：工具拒绝，并列出当前可见锚点。
- **工具组边界**：工具拒绝并解释组边界。
- **当前回合边界**：工具拒绝并指出受保护回合。
- **成本 guard**：在写事件前拒绝，并建议扩大 span、推迟 `to` 或写短摘要。
- **投影状态损坏/版本不匹配**：投影拒绝持久状态，回退到宿主 replay。
