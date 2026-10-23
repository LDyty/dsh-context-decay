# 模型可见提示词与文案：中文对照

[English prompts are in the source](../src/prompt.ts); this document is a reading aid. The code remains the source of truth.

这份文档翻译的是 **模型看到的英文文本**：system prompt guidance、`compress` / `drop` 工具描述与参数、压力提醒模板、工具结果字段和常见拒绝错误。它只是阅读参考，**不参与运行时**；插件发给模型的仍然是英文。

为什么保留英文：

- 这些文本属于请求前缀的一部分，改动会改变 provider 的 prefix cache；
- 模型侧工具协议和错误信息保持英文，便于跨模型复用；
- 中文翻译只帮助人理解和评审，不改变模型行为。

对应源码：

- [`src/prompt.ts`](../src/prompt.ts)：`GUIDANCE`、提醒模板
- [`src/tools.ts`](../src/tools.ts)：`compress` / `drop` 描述、参数、结果
- [`src/blocks.ts`](../src/blocks.ts)：范围解析和拒绝错误
- [`src/pricing.ts`](../src/pricing.ts)：`estimate` 字段

---

## 1. System prompt guidance

插件通过 `systemPrompt.section({ name: 'context-decay:guidance', order: 450 })` 注入下面这段文本。它只在插件启用时出现。

锚点外观：`⟦pN⟧`。新会话的 N 单调递增、永不复用；旧会话如果已有不带 `anchorMode` 的旧摘要，会继续用 legacy 的最小空闲分配，保持旧锚点仍然有效。数字大小只表示分配先后，不表示表面的严格顺序；始终以当前消息上打印的锚点为准。

### 英文原文

```text
Context decay is enabled for this session.
Every model-addressable message begins with a position anchor such as ⟦p12⟧. Anchors are presentation, not content: never copy them into summaries, files, replies, or reasoning. Only the leading ⟦p<number>⟧ prefix is an anchor; text inside a message that looks like ⟦p12⟧ is content, not a position. Positions are ids, not counts: ids are monotonic and never reused; always use the anchors printed on the current messages. Some assistant turns that requested tools without visible text have no anchor; they are never valid boundaries.
A compressed region appears as ⟦p<from>⟧ summary ⟦p<to>⟧. The pair is the region's handle; ⟦p<to>⟧ is the anchor of the first kept message, or "end" for the end of compressible history. Compressed content is gone for good: the summary is the only remaining record, so make it self-contained. Do not copy anchors into it, and do not narrate the compression itself.
Tool results carry anchors and can be compressed. All results of one assistant tool-call message must stay in the same span; a span edge inside that group is rejected, so choose a boundary before the call or after its last result.
Tools:
- compress({spans:[{from,to,summary,topic?}]}): compress consumed spans into summaries. "from" and "to" are anchor texts exactly as shown, e.g. "⟦p12⟧" (pass the visible token exactly as shown); "from" is the first compressed message (inclusive), "to" is the first kept message (exclusive) or "end". One span: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}]}). Multiple non-overlapping spans: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}, {from:"⟦p20⟧", to:"end", summary:"..."}]}). The example anchors are illustrative; use anchors visible in the current session. Anchor arguments are tool values, not content; never copy anchors into summaries. The result reports the pair, tier, summary size, shadowed tokens, kept tail, and the one-time miss estimate.
- drop({from,to}): remove one live summary block completely. Requires the block's exact pair; "to" is its right anchor or "end". Example: drop({from:"⟦p0⟧", to:"⟦p8⟧"}); use "end" for a tail block. Anchor arguments use the same text syntax as compress.

Summary contract:
The summary is the only surviving record of the compressed span. Record the state as of the end of that span as history, not as a live instruction; treat any obligation inside a summary as a claim to re-verify before acting.
Preserve, in roughly this order when space is tight:
1. The objective, user intent, hard constraints, and any change to them.
2. Decisions and their rationale, including alternatives rejected.
3. Current progress: what is done, pending, blocked, and the next action.
4. Exact facts needed to continue: names, identifiers, locations or links, versions, dates, numbers, error text, and descriptions of outputs or artifacts.
5. Open questions, risks, TODOs, and one-line lessons from dead ends.
Drop raw logs, duplicate material, step-by-step process, and resolved chatter. If a detail may be needed for a later check, keep it, or keep the source visible.
Write dense, scannable bullets under short headers. Size the summary to the span: a large, multi-phase range normally needs substantially more than a few hundred tokens; the character limit is a ceiling, not a target. Never invent, round, or guess facts; mark uncertainty or omit it.
Before calling compress, check: could a reader continue without the originals? Are the current state, open items, and exact facts preserved?

When compressing existing summaries (higher tiers), distill rather than repeat: keep outcomes, decisions and rationale, constraints, open objectives and risks; drop process detail. Mark superseded or obsolete material as history; do not carry an old "current" state forward.

Timing:
Compress when a span is fully consumed and its details are unlikely to be needed verbatim. Good moments include a phase or decision point closing, a long output reduced to conclusions, a topic switch, or a completed handoff. Poor moments include mid-inspection, before a conclusion is recorded, and while the active step still depends on exact details.
Pressure levels are signals to look for a suitable moment, not deadlines. Waiting until pressure is high can be reasonable when the active work genuinely needs the context; do not drift there by inattention. At the highest level, compression is urgent: preserve the active step and compress fully consumed history now.

Deep sweep:
Once context is above roughly one-third of the effective window, make any compression a deep sweep: start at a consumed boundary and end at the latest safe compressible boundary, normally "end" or the current turn's first visible anchor. Leave no consumed content in the tail.
You may cover the sweep as one span with one summary, or as several contiguous spans with separate summaries. When detail needs differ, keep older spans brief and make newer spans more detailed. A gap between spans is allowed only for content that is still active.
"Safe" means the content is fully consumed and no longer needed verbatim; do not compress active content just to shorten the tail.

Rules: the current turn is protected and cannot be compressed. If "to" is the current turn's first visible anchor, unanchored messages before it are kept and only the history before the turn is compressed; "end" still means the end of compressible history. Prefer compressing old, fully consumed work and keeping the current work. A compression invalidates the cached prefix from "from" onward: messages after the compressed range are re-sent uncached once, so a compression that starts early and leaves a large kept tail costs more. Prefer compressing a contiguous block of fully consumed work and placing "to" as late as the task allows. If content in the middle must stay live, compress the consumed spans on either side of it separately; the live gap stays visible, and the cache cost is still measured from the earliest compressed position. Pass all consumed spans in one call when possible: separate calls invalidate the prefix again. Do not compress still-needed recent work just to shorten the tail. Pressure reminders repeat every growth step; the warning level follows the current pressure band, and the critical band repeats on a shorter step. Use those signals to find a suitable moment; the highest level makes compression urgent, not automatic.
```

### 中文翻译

```text
上下文衰减已为本会话启用。
每条可被模型寻址的消息都以位置锚点开头，例如 ⟦p12⟧。锚点只是展示，不是内容：绝不要把锚点复制进摘要、文件、回复或推理。只有消息开头的 ⟦p<number>⟧ 前缀才是锚点；消息正文里看起来像 ⟦p12⟧ 的文本是内容，不是位置。位置是 id，不是计数：id 单调递增、永不复用；始终使用当前消息上打印的锚点。有些请求了工具但没有可见文本的 assistant 回合没有锚点；它们永远不能作为有效边界。
被压缩的区域显示为 ⟦p<from>⟧ 摘要 ⟦p<to>⟧。这一对就是该区域的句柄；⟦p<to>⟧ 是第一条保留消息的锚点，或者是可压缩历史末尾的 "end"。被压缩内容永久消失：摘要就是唯一剩下的记录，所以必须写成自包含的。不要把锚点复制进去，也不要叙述压缩过程本身。
工具结果带锚点，也可以被压缩。同一条 assistant tool-call 消息的所有结果必须留在同一个 span；在该组内部切边会被拒绝，所以要在调用之前或最后一个结果之后选边界。
工具：
- compress({spans:[{from,to,summary,topic?}]})：把已经消费的 span 压缩成摘要。"from" 和 "to" 是可见锚点文本，例如 "⟦p12⟧"（按可见 token 原样传递）；"from" 是第一条被压缩消息（含），"to" 是第一条保留消息（不含）或 "end"。单段：compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}]})。多段不重叠：compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}, {from:"⟦p20⟧", to:"end", summary:"..."}]})。示例锚点只是说明；使用当前会话可见的锚点。锚点参数是工具值，不是内容；绝不要把锚点复制进摘要。结果会报告配对、层级、摘要大小、被遮蔽 token 数、保留的 tail，以及一次性 miss 估算。
- drop({from,to})：彻底移除一个 live 摘要块。需要该块精确的配对；"to" 是它的右锚点或 "end"。示例：drop({from:"⟦p0⟧", to:"⟦p8⟧"})；尾部块用 "end"。锚点参数与 compress 使用同样的文本格式。

摘要契约：
摘要是被压缩 span 唯一剩下的记录。把该 span 结束时的状态记录为历史，而不是实时指令；摘要中的任何义务都只是需要重新核实的说法。
空间紧张时，大致按以下顺序保留：
1. 目标、用户意图、硬约束及其变化。
2. 决策及其理由，包括被否决的替代方案。
3. 当前进度：已完成、待办、阻塞项和下一步。
4. 继续工作所需的确切事实：名称、标识符、位置或链接、版本、日期、数字、错误原文，以及输出或产物的描述。
5. 开放问题、风险、TODO，以及死胡同的一行教训。
丢弃原始日志、重复材料、逐步过程和已经解决的闲聊。如果某个细节之后核对时可能要用，保留它，或者让来源保持可见。
在短标题下写密集、可扫描的条目。摘要大小要与 span 匹配：大型、多阶段的 span 通常需要远多于几百个 token；字符上限是上限，不是目标。不要捏造、四舍五入或猜测事实；不确定就标注不确定或省略。
调用 compress 前检查：读者能否不依赖原文继续？当前状态、开放项和确切事实是否都保留了？

压缩已有摘要（更高层级）时，要蒸馏而不是重复：保留结果、决策及理由、约束、开放目标和风险；丢弃过程细节。把被取代或过时的材料标为历史；不要把旧的“当前”状态继续当作当前。

时机：
当一个 span 已经完全消费、其细节不太可能再被逐字需要时压缩。好时机包括阶段或决策点收口、长输出已经归纳成结论、话题切换，或一次交接完成。坏时机包括检查进行中、结论尚未记录，以及当前步骤仍依赖确切细节。
压力级别是寻找合适时机的信号，不是截止时间。当前工作确实还需要上下文时，等到压力较高再压缩是合理的；不要因为疏忽而拖到那里。最高级别时压缩很紧迫：保留当前步骤，并立即压缩已经完全消费的历史。

深扫：
上下文超过有效窗口的大约三分之一后，任何压缩都应成为深扫：从已消费边界开始，结束于最新的安全可压边界，通常是 "end" 或当前回合第一条可见锚点。不要把已消费内容留在 tail。
你可以用一个 span、一个摘要覆盖整个深扫；也可以用多个连续 span、各自摘要。细节需求不同时，旧 span 写简，新 span 写详。span 之间只允许为仍然活跃的内容留空隙。
“安全”指内容已经完全消费、不再需要逐字保留；不要为了缩短 tail 去压缩活跃内容。

规则：当前回合受保护，不能被压缩。如果 "to" 是当前回合第一条可见锚点，它前面的无锚点消息会保留，只压缩回合之前的历史；"end" 仍表示可压缩历史末尾。优先压缩旧的、已经完全消费的工作，保留当前工作。压缩会让从 "from" 开始的缓存前缀失效：压缩范围之后的消息会以未缓存方式重发一次，所以开始得很早、保留 tail 很大的压缩成本更高。优先压缩一段连续、完全消费的工作，并让 "to" 尽可能靠后。如果中间内容必须保持 live，就分别压缩它两侧已消费的 span；live 间隙保持可见，缓存成本仍从最早被压缩的位置算起。尽可能在一次调用里传入所有已消费 span：分开调用会让前缀再次失效。不要只是为了缩短 tail 去压缩仍然需要的近期工作。压力提醒在每个增长步长重复；警告级别跟随当前压力档位，critical 档使用更短的步长。把这些信号用于寻找合适时机；最高级别让压缩变得紧迫，但不是自动执行。
```

---

## 2. `compress` 工具

### 工具描述（英文原文）

```text
Compress fully consumed history into self-contained, lossy summaries. Each span is a half-open range of visible anchors: "from" is the first compressed message (inclusive); "to" is the first kept message (exclusive) or "end" for the end of compressible history. Pass the anchor text exactly as shown, e.g. "⟦p12⟧"; pass the visible token exactly as shown. One span: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}]}). Multiple non-overlapping spans: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}, {from:"⟦p20⟧", to:"end", summary:"..."}]}). Examples use illustrative ids; use anchors visible in the current session. The current turn is always kept; if "to" is its first visible anchor, unanchored messages before it are kept automatically. A span edge that would split an assistant tool call from its results is rejected: all results of one assistant tool-call message must stay in the same span. Compressed content cannot be recovered: the summary must follow the summary contract in the guidance and carry every fact that still matters. The result reports the pair, tier, summary size, shadowed tokens, kept tail, and the one-time miss estimate.
```

### 中文翻译

```text
把完全消费的历史压缩成自包含的、有损摘要。每个 span 是一个可见锚点的半开区间："from" 是第一条被压缩消息（含），"to" 是第一条保留消息（不含）或 "end"（可压缩历史末尾）。锚点按原样传递，例如 "⟦p12⟧"；按可见 token 原样传递。单段：compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}]})。多段不重叠：compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}, {from:"⟦p20⟧", to:"end", summary:"..."}]})。示例中的 id 只是说明；使用当前会话可见的锚点。当前回合始终保留；如果 "to" 是它第一条可见锚点，前面的无锚点消息会自动保留。会拆开 assistant tool call 与其结果的 span 边界会被拒绝：同一条 assistant tool-call 消息的所有结果必须留在同一个 span。被压缩内容无法恢复：摘要必须遵循 guidance 中的摘要契约，并携带所有仍然重要的事实。结果会报告配对、层级、摘要大小、被遮蔽 token 数、保留的 tail，以及一次性 miss 估算。
```

### 参数

| 参数 | 英文原文 | 中文 |
|---|---|---|
| `spans` | Consumed regions to compress, in any order; spans must not overlap. | 要压缩的已消费区域，顺序任意；span 不能重叠。 |
| `spans[].from` | Inclusive anchor text, e.g. `"⟦p12⟧"`. | 第一条被压缩消息的闭区间锚点文本，例如 `"⟦p12⟧"`。 |
| `spans[].to` | Exclusive anchor text, e.g. `"⟦p20⟧"`, or `"end"`. | 第一条保留消息的锚点文本，例如 `"⟦p20⟧"`，或 `"end"`。 |
| `spans[].to = "end"` | "end" keeps no tail: compress through the end of compressible history. | "end" 不保留 tail：一直压缩到可压缩历史的末尾。 |
| `spans[].summary` | Self-contained summary replacing the span; preserve state, decisions, exact facts, and open items per the summary contract. | 替换该 span 的自包含摘要；按摘要契约保留状态、决策、确切事实和开放项。 |
| `spans[].topic` | Optional short topic stored in the block ledger. | 可选的短主题，存入块 ledger。 |

`required`：`from`、`to`、`summary`；`additionalProperties: false`。

---

## 3. `drop` 工具

### 工具描述（英文原文）

```text
Remove one live summary block completely: the summary and its left anchor disappear with no tombstone and nothing is retained. Requires the block's exact live pair [from, to); "to" is the block's right anchor or "end". Pass the displayed anchors, e.g. drop({from:"⟦p0⟧", to:"⟦p8⟧"}). Use compress to shrink content instead of deleting a summary.
```

### 中文翻译

```text
彻底移除一个 live 摘要块：摘要及其左锚点消失，没有墓碑，不保留任何东西。需要该块精确的 live 配对 [from, to)；"to" 是该块的右锚点或 "end"。按显示的锚点传递，例如 drop({from:"⟦p0⟧", to:"⟦p8⟧"})；裸 "px…" 和整数 0 也接受。要缩小内容请用 compress，不要删除摘要。
```

### 参数

| 参数 | 英文原文 | 中文 |
|---|---|---|
| `from` | Left anchor text of the live summary block, e.g. `"⟦p0⟧"` (bare `"px…"` and integer 0 also accepted). | live 摘要块的左锚点文本，例如 `"⟦p0⟧"`（裸 `"px…"` 和整数 0 也接受）。 |
| `to` | Right anchor text, e.g. `"⟦p8⟧"`, or `"end"`. | 右锚点文本，例如 `"⟦p8⟧"`，或 `"end"`。 |
| `to = "end"` | The block currently reaches the end of compressible history. | 该块当前一直延伸到可压缩历史的末尾。 |

`required`：`from`、`to`；`additionalProperties: false`。

---

## 4. 压力提醒模板

提醒以 `user/message` 注入，`source.kind = "context-decay"`、`source.form = "notice"`。每增长一个步长发一条提醒，类型跟随当前压力档位（70% / 81% / 95%），同一档位重复，最后一档是 critical 且使用更短步长；跨入更高档位会立即触发。

模板变量：

- `${growth}`：自上次提醒增长的 token，格式化后如 `~20K tokens`，没有基线时为 `enough`；
- `${pressure}`：`已用 token/有效窗口`，如 `653K/744K`；
- `${ratio}`：百分比，如 `88%`；
- `${levels}`：配置的警告档数，默认 3；
- `${level}`：当前警告档位；
- `${example}`：根据当前首个/最后位置生成的**单段** `compress(...)` 示例；示例里的
  `from`/`to` 是可见锚点文本，例如 `from:"⟦p4⟧"`、`to:"⟦p20⟧"`；多段和 `drop` 的完整示例见
  第 1 节的 GUIDANCE；
- `${tail}`：四条提醒共用的尾部说明。
- `${deepSweep}`：当 `${ratio}` 达到有效窗口的 1/3 后追加的深扫提示；否则为空。

### 普通增长提醒

```text
Context grew by ${growth} since the last reminder (${pressure}, ${ratio}). When a suitable break appears, compress fully consumed history: ${example}.${deepSweep} ${tail}
```

```text
自上次提醒以来上下文增长了 ${growth}（当前 ${pressure}，${ratio}）。出现合适停顿点时，请压缩已经完全消费的历史：${example}。${deepSweep}${tail}
```

### 警告 1/3

```text
Context pressure is ${ratio} (${pressure}) — warning 1/${levels}. When a suitable break appears, consider compressing fully consumed history; if pressure is rising faster than expected, act sooner: ${example}.${deepSweep} ${tail}
```

```text
上下文压力为 ${ratio}（${pressure}）——警告 1/${levels}。出现合适停顿点时，考虑压缩已经完全消费的历史；如果压力上升比预期快，就提前行动：${example}。${deepSweep}${tail}
```

### 警告 N/${levels}（非最后一档）

```text
Context pressure is ${ratio} (${pressure}) — warning ${level}/${levels}. Plan a compression at a suitable break; if none is near, compress fully consumed history up to the active step: ${example}.${deepSweep} ${tail}
```

```text
上下文压力为 ${ratio}（${pressure}）——警告 ${level}/${levels}。计划在合适停顿点压缩；如果附近没有停顿点，就压缩已经完全消费的历史，直到当前步骤之前：${example}。${deepSweep}${tail}
```

### Critical（最后一档）

```text
CRITICAL: context pressure is ${ratio} (${pressure}). The next request may exceed the window. Compress fully consumed history now, preserving the active step: ${example}.${deepSweep} ${tail}
```

```text
严重（CRITICAL）：上下文压力为 ${ratio}（${pressure}）。下一次请求可能超出窗口。请立即压缩已经完全消费的历史，同时保留当前步骤：${example}。${deepSweep}${tail}
```

### 共用尾部 `${tail}`

```text
from/to are anchor texts copied from the visible ⟦pN⟧ prefixes (for example "⟦p12⟧"); "end" means the end of compressible history. Multiple non-overlapping spans use the same syntax in one call. The current turn is protected; summaries are lossy — preserve state, decisions, exact facts, and open items inside the summary.
```

```text
from/to 是复制自可见 `⟦pN⟧` 前缀的锚点文本（例如 `"⟦p12⟧"`）；`"end"` 表示可压缩历史的末尾。
多个不重叠的 span 在一次调用里使用同样的语法。当前回合受保护；摘要是有损的——把状态、决策、确切事实和开放项写进摘要。
```

当 `endPosition` 为空时，示例里的 `to` 为 `"end"`。

---

## 5. 工具结果字段

工具**输入**使用锚点文本；结果字段仍报告整数位置 id。

### `compress` 成功结果

```json
{
  "ok": true,
  "applied": [
    {
      "from": 12,
      "to": 18,
      "tier": 1,
      "summaryChars": 420,
      "shadowedMessages": 6,
      "shadowedTokens": 3156
    }
  ],
  "estimate": {
    "summaryTokens": 180,
    "keptTailMessages": 12,
    "keptTailTokens": 4100,
    "anchorTokens": 39,
    "oneTimeMissTokens": 4319,
    "shadowedTokens": 3156,
    "paybackRequests": 5
  }
}
```

| 字段 | 中文 |
|---|---|
| `ok` | 成功标记。 |
| `applied[]` | 每个实际生效的 span。 |
| `applied[].from` / `to` | 实际生效的配对；`to = null` 表示一直延伸到末尾。 |
| `applied[].tier` | 新摘要块的层级；1 是首次压缩，2/3 是对已有摘要的再压缩。 |
| `applied[].summaryChars` | 摘要字符数。 |
| `applied[].shadowedMessages` | 被替换的消息数。 |
| `applied[].shadowedTokens` | 被遮蔽的估算 token 数。 |
| `estimate.summaryTokens` | 摘要本身的估算 token。 |
| `estimate.keptTailMessages` / `keptTailTokens` | 压缩后保留的 tail 消息数和 token 数。 |
| `estimate.anchorTokens` | 锚点文本的估算 token。 |
| `estimate.oneTimeMissTokens` | 压缩后第一次请求预计的 cache miss token。 |
| `estimate.shadowedTokens` | 被遮蔽内容的总 token。 |
| `estimate.paybackRequests` | 预计多少请求回本；无法回本时为 `null`。 |

### `drop` 成功结果

```json
{
  "ok": true,
  "dropped": { "from": 12, "to": 18, "tokens": 420 }
}
```

| 字段 | 中文 |
|---|---|
| `ok` | 成功标记。 |
| `dropped.from` / `to` | 被移除块的配对；`to = null` 表示一直延伸到末尾。 |
| `dropped.tokens` | 该块原本占用的估算 token。 |

---

## 6. 常见拒绝错误

这些错误会作为 tool result 返回给模型；下面只翻译最常见的几条，英文原文才是实际输出。

### 6.1 范围与锚点

| 英文原文 | 中文 |
|---|---|
| `compress: spans[0].from must be an anchor like "⟦p12⟧" (bare "px…" and integer 12 are also accepted)` | `from` 必须是类似 `"⟦p12⟧"` 的锚点文本；裸 `"px…"` 和整数 12 也接受。 |
| `compress: spans[0].to must be an anchor like "⟦p12⟧" or "end" (bare "px…" and integer 12 are also accepted)` | `to` 必须是类似 `"⟦p12⟧"` 的锚点文本或 `"end"`；裸 `"px…"` 和整数 12 也接受。 |
| `compress: ⟦p12⟧ is not a visible message anchor. visible message anchors (message order): ...` | ⟦p12⟧ 不是可见消息锚点。可见消息锚点（按消息顺序）：... |
| `compress: there is no compactable history yet (the current turn is protected)` | 当前还没有可压缩历史（当前回合受保护）。 |
| `compress: the span includes the current turn, which is protected. The current turn begins with unanchored messages before ⟦p7⟧. Use "end" as "to" to compress all history before the current turn, or choose a boundary before the current turn.` | span 包含受保护的当前回合。当前回合在 ⟦p7⟧ 之前还有无锚点消息。请用 `"end"` 压缩当前回合之前的全部历史，或在当前回合之前选边界。 |
| `compress: the span includes the current turn, which is protected. The current turn starts at ⟦p7⟧. Use "end" as "to" to compress all history before the current turn, or choose a boundary before the current turn.` | span 包含受保护的当前回合。当前回合从 ⟦p7⟧ 开始。请用 `"end"` 压缩当前回合之前的全部历史，或在当前回合之前选边界。 |
| `compress: there is no compressible history before the current turn; wait until the turn ends.` | 当前回合之前还没有可压缩历史；等这个回合结束后再压缩。 |
| `compress: [⟦p5⟧, ⟦p3⟧) selects no content: "to" precedes "from" in message order. Positions are ids, not increasing numbers; use the anchors printed on the messages.` | 这个范围选不到内容：在消息顺序里 `to` 在 `from` 之前。位置是 id，不是递增数字；请使用消息上打印的锚点。 |
| `compress: the span contains no model-addressable content` | 这个 span 不含可被模型寻址的内容。 |

### 6.2 工具调用组被切开

```text
compress: "from" ⟦p8⟧ is inside an assistant tool-call group. All results of one assistant tool-call message must stay in the same span; choose an anchor before the call or after its last result. visible message anchors (message order): ...
```

```text
compress: "from" ⟦p8⟧ 落在 assistant tool-call 组内部。同一条 assistant tool-call 消息的所有结果必须留在同一个 span；请在调用之前或最后一个结果之后选锚点。可见消息锚点（按消息顺序）：...
```

```text
compress: "to" ⟦p9⟧ is inside an assistant tool-call group. All results of one assistant tool-call message must stay in the same span; choose a boundary after the group's last result, or before the call. If the group is still open in the current turn, wait for its results or choose an explicit "to" before the call. visible message anchors (message order): ...
```

```text
compress: "to" ⟦p9⟧ 落在 assistant tool-call 组内部。同一条 assistant tool-call 消息的所有结果必须留在同一个 span；请在组最后一个结果之后、或调用之前选边界。如果该组在当前回合仍未结束，请等待结果，或在调用前显式选一个 "to"。可见消息锚点（按消息顺序）：...
```

### 6.3 多个 span

| 英文原文 | 中文 |
|---|---|
| `compress: spans overlap. Compress each consumed region at most once per call (adjacent spans are allowed; overlapping spans are not).` | span 相互重叠。每次调用中，每个已消费区域最多压缩一次（相邻 span 允许，重叠 span 不允许）。 |
| `compress: at most 8 spans per call` | 每次调用最多 8 个 span。 |
| `compress: spans[0].summary must be at least 20 characters (got 12); the summary is the only surviving record of the compressed content` | 摘要至少 20 字符（当前 12）；摘要是被压缩内容唯一存活的记录。 |
| `compress: spans[0].summary is 9000 characters; the limit is 8000` | 摘要 9000 字符，上限 8000。 |

### 6.4 `drop`

| 英文原文 | 中文 |
|---|---|
| `drop: no live summary block matches [⟦p3⟧, ⟦p5⟧). Known blocks: ... Use the pair printed around the live summary block.` | 没有匹配 `[⟦p3⟧, ⟦p5⟧)` 的 live 摘要块。已知块：... 请使用摘要块周围打印的配对。 |
| `drop: "from" must be an anchor like "⟦p12⟧" (bare "px…" and integer 12 are also accepted)` | `drop` 的 `from` 必须是类似 `"⟦p12⟧"` 的锚点文本；裸 `"px…"` 和整数 12 也接受。 |
| `drop: "to" must be an anchor like "⟦p12⟧" or "end" (bare "px…" and integer 12 are also accepted)` | `drop` 的 `to` 必须是类似 `"⟦p12⟧"` 的锚点文本或 `"end"`；裸 `"px…"` 和整数 12 也接受。 |

### 6.5 成本保护

```text
compress: rejected by the miss guard: the first request after this compression would miss about ${oneTimeMissTokens} tokens (limit ${maxMissTokens}; summary ${summaryTokens}, kept tail ${keptTailTokens}, anchors ${anchorTokens}). Suggestions: ...
```

```text
compress: 被 miss guard 拒绝：这次压缩后的第一次请求预计 miss 约 ${oneTimeMissTokens} token（上限 ${maxMissTokens}；摘要 ${summaryTokens}，保留 tail ${keptTailTokens}，锚点 ${anchorTokens}）。建议：...
```

```text
compress: rejected by the payback guard: the compression would take about ${paybackRequests} requests to pay back its ~${oneTimeMissTokens}-token first-request miss (limit ${maxPaybackRequests}). Suggestions: ...
```

```text
compress: 被回本保护拒绝：这次压缩大约需要 ${paybackRequests} 个请求才能回本其首次请求约 ${oneTimeMissTokens} token 的 miss（上限 ${maxPaybackRequests}）。建议：...
```

---

## 7. 修改这些文案时

- 不要为了中文翻译直接改 `GUIDANCE` 或工具描述；这会让每次请求的前缀变化；
- 如果要改英文原文，同时更新本文档，并跑 `npm test`；
- `compress` / `drop` 的参数名、`required` 和 `additionalProperties` 是模型协议的一部分，不是文案；
- 客户端面板文案已经有 `en` / `zh` 字典，不在这份文档范围内。
