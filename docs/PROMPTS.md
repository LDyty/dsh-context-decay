# 提示词与模型可见文案

本文件记录「上下文自觉压缩」发给模型的中文文本。运行时以源码为准：

- [`src/prompt.ts`](../src/prompt.ts)：system prompt guidance、极简压力提醒；
- [`src/tools.ts`](../src/tools.ts)：`compress` 工具描述、参数说明和工具结果；
- [`src/blocks.ts`](../src/blocks.ts)：范围解析和拒绝错误；
- [`src/projection.ts`](../src/projection.ts)：侧栏投影字段。

模型可见提示词已经全部中文化；`compress`、`span`、`summary`、`tool-call`、`tier`、`tail` 等关键名词保留英文。旧版英文文档已从项目中移除。

## 1. System prompt guidance

```text
上下文自觉压缩已启用。

本会话中，每条可被模型寻址的消息前都会显示一个四字符锚点，例如 ⟦#a8c5⟧。锚点是定位句柄，不属于消息内容；写摘要、文件或回复时，请让内容保持自包含。消息正文里看起来像 ⟦#a8c5⟧ 的文本只是内容，不是锚点。锚点会回收复用，句柄本身不代表消息先后；请以当前消息上打印的锚点为准。有少量 assistant 回合只请求工具、没有可见文本，因此没有锚点；它们不能作为 span 边界。

压缩区域显示为 ⟦#<from>⟧ 摘要 ⟦#<to>⟧。这一对就是该区域的句柄：右侧锚点是第一条保留消息，或者是可压缩历史末尾的 "end"。摘要会替代原内容，请把继续工作需要的事实完整写进摘要。

同一条 assistant tool-call 消息的所有结果可以一起压缩；span 边界请放在整个 tool-call 组之前或最后一个结果之后。

工具：
- compress({spans:[{from,to,summary,topic?}]})：把已经消费完的 span 压缩成自包含摘要。"from" 是第一条被压缩消息（含），"to" 是第一条保留消息（不含）或 "end"；锚点从消息前缀复制，例如 "⟦#a8c5⟧"（也接受裸 "#a8c5" 或 "a8c5"）。示例锚点只是说明；使用当前会话可见的锚点。锚点参数是工具值，不是摘要内容。

摘要契约：
摘要是被压缩 span 唯一剩下的记录。把 span 结束时的状态写成历史，而不是写成当前指令；摘要里的待办事项在继续执行前要重新核实。
空间紧张时，大致按这个顺序保留：目标、用户意图、硬约束及变化；决策及理由；当前进度；继续工作需要的精确事实；开放问题、风险、TODO 和死路教训。
用短标题下的密集要点写高保真摘要，保留正确、有用的事实、精确标识符、路径、版本、决策和证据；不要编造、四舍五入或猜测事实。
```

完整文本以 `src/prompt.ts` 的 `GUIDANCE` 常量为准；上面是便于阅读的摘录，未改变语义。

## 2. `compress` 工具

工具名：`compress`。

参数：

| 字段 | 含义 |
| --- | --- |
| `spans` | 要压缩的已消费区域；非空，span 之间不能重叠。 |
| `spans[].from` | 闭区间锚点，例如 `⟦#a8c5⟧`；也接受裸 `#a8c5` 或 `a8c5`。 |
| `spans[].to` | 排他锚点，例如 `⟦#c9d1⟧`，或 `end`。 |
| `spans[].summary` | 替代该 span 的自包含摘要；锚点会被剥离。 |
| `spans[].topic` | 可选短主题，记录到摘要块账本。 |

成功结果：

```json
{
  "ok": true,
  "applied": [
    {
      "from": "a8c5",
      "to": "c9d1",
      "tier": 1,
      "summaryChars": 2588,
      "shadowedMessages": 734,
      "shadowedTokens": 296370
    }
  ],
  "estimate": {
    "summaryTokens": 1250,
    "keptTailMessages": 4,
    "keptTailTokens": 652,
    "anchorTokens": 8,
    "oneTimeMissTokens": 1917,
    "shadowedTokens": 296370,
    "paybackRequests": 1
  }
}
```

结果中的 `from`/`to` 是锚点句柄；`to = null` 表示 span 一直延伸到可压缩历史末尾。

## 3. 压力提醒

提醒由宿主在 `agent/pre-step` 注入，每个 step 最多一条：

- 间隔固定为有效窗口的 2.5%；
- 首次观察只建立静默基线；
- 压缩后压力下降时静默重置基线；
- 模板只保留「已用 token/有效窗口」和百分比，不携带规则、示例或工具调用说明。

模板：

```text
来自自觉压缩工具的提醒：已用 {已用 token}/{有效窗口 token}（{百分比}）。
```

示例：

```text
来自自觉压缩工具的提醒：已用 108K/744K（15%）。
```

## 4. 面板文案

侧栏面板标题、标签和提示全部中文，产品名是「上下文自觉压缩」。面板数据字段仍使用 `DecayState` 的英文技术名（如 `allocated`、`anchorPool`、`compressibleEndPosition`），它们是协议/代码字段，不是模型提示词。
