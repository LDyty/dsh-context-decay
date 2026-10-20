# dsh-context-decay

[简体中文](README.zh-CN.md)

Model-driven, **lossy** context decay for DeepSeek Harness.

The model decides when and what to compress. Finished spans are replaced by
self-written summaries; the current turn is always kept. There is no recovery:
the summary is the only surviving record.

> **Install note:** This is a **manual-install** plugin: it requires a DSH
> checkout with the `modelMessageDecoration` seam and is not a drop-in
> plugin-market bundle (see [Requirements](#requirements)).

![Sidebar panel: effective-window pressure, total-window occupancy, reminder state, and context-ordered position space](docs/assets/panel.png)

## What it does

- **Inline position anchors.** Every model-addressable message with a visible
  text block is prefixed with `⟦p<number>⟧`; tool-call-only assistant turns are
  unanchored by design. Compression ranges use those anchors directly:
  `⟦p<from>⟧ summary ⟦p<to>⟧`. Anchors are presentation, never part of the content.
- **Copied anchors removed.** If the model starts a reply with one or more
  anchors, the leading run is stripped at the request boundary and again before
  the reply is committed, so the transcript and later requests stay clean.
- **Model-selected spans.** The model calls `compress` with one or more
  half-open ranges and writes each summary itself. No extra summarizer request.
  Split around content that must stay live; pass all consumed spans in one call
  so the prefix is not invalidated repeatedly.
- **Lossy by design.** Compressed content is gone. There is no `decompress`, no
  original-text search, and no external table. The summary must be self-contained.
- **Tool results are compressible.** All results of one assistant tool-call
  message must stay in the same span. A boundary inside that group is rejected;
  the plugin never silently widens a span.
- **Current turn protection.** The active turn and its tool results cannot be
  compressed. If the turn starts with unanchored system/runtime messages, a `to`
  boundary at its first visible anchor keeps those messages and compresses only
  the history before the turn; `"end"` remains the end-of-compressible-history
  sentinel.
- **Tiered re-compression.** Compressing a live summary block again produces a
  tier-2 summary; larger merges increase the tier. `drop` removes a block
  completely with no tombstone.
- **Pressure without automation.** The plugin reports context pressure and
  injects reminders when context grows noticeably or crosses a warning level.
  It never compresses automatically; the model decides.
- **Live panel + audit.** A sidebar panel shows pressure, blocks, positions,
  request counts, and the reminder ledger. An optional JSONL audit records each
  request and compression.

## Requirements

- DeepSeek Harness **0.2.1-rc.2** with the local host patch in
  [`patches/dsh-model-message-decoration.patch`](patches/dsh-model-message-decoration.patch)
  applied. Stock DSH does not expose the decoration seam; there is no runtime
  fallback. Installation alone is not enough: rebuild the host after patching.
- Node.js **>= 22.19**.
- A web profile. The client half needs the sidebar/session/locale UI packages
  listed in `package.json`.
- The bundle patch disables official **automatic** compaction
  (`compaction-basic.auto: false`), keeps the manual `/compact` command, and
  disables the in-place surface rewriters (`tool-result-pruner`,
  `image-offload`) when those rows exist. `/compact` remains an emergency
  host fallback; its checkpoint is not a context-decay block.

## Install

Manual patched install:

```bash
# 1. Apply the host patch to a DSH checkout and rebuild the host.
git -C /path/to/deepseek-harness apply /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
pnpm -C /path/to/deepseek-harness install
pnpm -C /path/to/deepseek-harness build

# 2. Install this plugin into a profile (checkout or tarball).
dsh plugin --profile web add /path/to/dsh-context-decay
# or: dsh plugin --profile web add ./dsh-context-decay-0.1.0.tgz

# 3. Restart the web server and open the profile.
dsh web --profile web
```

See [`docs/INSTALL.md`](docs/INSTALL.md) for the full patched-checkout workflow,
Windows commands, verification, updating, and rollback.

## Tools

| Tool | Purpose |
|---|---|
| `compress({spans:[{from,to,summary,topic?}]})` | Replace one or more half-open ranges with self-written summaries. `from`/`to` are visible anchor texts such as `"⟦p12⟧"` (bare `"p12"` and integer `12` also work); `to` may also be `"end"`. Several non-overlapping spans per call are allowed. Tool-group edges are rejected. |
| `drop({from,to})` | Remove exactly one live summary block. Use the block's printed anchor pair; `"end"` is allowed for a tail block. No tombstone, no recovery. |

A live summary block prints its pair inline as `⟦p<from>⟧ summary ⟦p<to>⟧`; use that
pair for `drop`. The sidebar panel shows pressure and the block ledger, so no
extra status tool is needed.

Examples:

```text
# one span
compress({spans:[{from:"⟦p4⟧", to:"⟦p9⟧", summary:"Read the three requirements files; constraints are ..."}]})

# two non-overlapping spans in one call
compress({spans:[
  {from:"⟦p4⟧", to:"⟦p9⟧", summary:"Read the requirements; constraints are ..."},
  {from:"⟦p9⟧", to:"end", summary:"Implemented the parser and tests; ..."}
]})

# drop one live summary block
drop({from:"⟦p4⟧", to:"⟦p9⟧"})
```

The anchor ids above are illustrative; use anchors visible in the current
session.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Enable the plugin. |
| `contextWindowTokens` | route value | Override the total context window. |
| `reservedOutputTokens` | route value | Override the reserved output budget. |
| `defaultContextWindowTokens` | `128000` | Fallback when the route has no window. |
| `growthTokens` | `20000` | Normal reminder after this much growth since the last reminder. |
| `warnRatios` | `[0.70, 0.81, 0.95]` | Warning levels as fractions of the effective window. |
| `reminderCooldownTurns` | `1` | Minimum turns between reminders. |
| `maxSpansPerCall` | `8` | Maximum spans in one `compress` call. |
| `minSummaryChars` | `20` | Minimum summary length. |
| `maxSummaryChars` | `8000` | Maximum summary length. |
| `maxMissTokens` | `null` | Optional one-time miss guard. |
| `maxPaybackRequests` | `null` | Optional payback guard. |
| `audit` | `false` | Write request/compression audit JSONL. |
| `debug` | `false` | Verbose plugin logging. |

The **effective window** is `total window - reserved output`. The model sees
pressure as a fraction of the effective window. The panel labels that percentage
as effective pressure, shows the total and reservation, and adds a total-window
occupancy line for direct comparison with the built-in context meter. Pressure,
reminder, and request facts are kept per session, so switching sessions updates
the panel.

## How it works

The host patch adds a `modelMessageDecoration` service. The plugin registers a
decoration provider that prefixes the messages selected by the replay state;
the agent loop, token meter, and request payload all apply the same decoration.
Positions come from the replayed surface, not from message text. Compressions
append `compaction/start`, `compaction/summary`, a replacement user message, and
`compaction/end`; replay rebuilds blocks, tiers, and the free list.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the state model,
invariants, and failure modes.

See [`docs/PROMPTS.zh-CN.md`](docs/PROMPTS.zh-CN.md) for a Chinese translation of
the model-facing prompts, tool descriptions, reminders, and error copy.

## Limitations and non-goals

- **No recovery.** There is no decompress, search, or spill archive. This is
  deliberate; it is also the main trade-off.
- **Requires a patched host.** The decoration seam is not upstream. Without it
  the plugin cannot safely present anchors or replay positions.
- **No automatic compression.** Reminders are advisory. A model may ignore them;
  the budget stays protected by the request guard, not by silent compaction.
  The official automatic policy is off; manual `/compact` remains available.
- **`/compact` is a manual fallback.** It runs the official backend and writes an
  official checkpoint, not a context-decay tier block. Use it only when a
  session is already too large for a normal request.
- **Manual install, not a market bundle.** A market index cannot express the
  host-patch requirement, and `engines.dsh` cannot distinguish a patched host
  from a stock one. Distribute the checkout or tarball with the patch
  instructions until the seam is upstream.
- **One compression backend per profile.** Do not run another compaction backend
  or an in-place surface rewriter alongside it.
- **Replay depends on the current event format.** Compression replay uses the
  current `surfaceOp` and compaction event shape.

## Development

```bash
npm install          # if building outside a DSH checkout
npm run build        # src/ -> lib/ (JS + declarations), client/ -> lib/client.js
npm run check        # typecheck only
npm test             # node:test suite against lib/
```

Local development can reuse a DSH checkout's TypeScript: set
`DSH_HARNESS_ROOT` or place the checkout next to this package.

## License

MIT. See [LICENSE](LICENSE).
