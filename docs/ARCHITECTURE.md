# Architecture

[简体中文](ARCHITECTURE.zh-CN.md)

This document describes the implementation.

## 1. Host seam

Stock DeepSeek Harness does not let a plugin decorate model-visible messages at
the request boundary. The local patch
`patches/dsh-model-message-decoration.patch` adds a
`modelMessageDecoration` service and applies its result in three places:

- the agent loop, before messages are handed to the model adapter;
- the token meter, so pressure accounting includes the same decoration;
- the request payload, so the model and the meter see identical text.

The plugin registers a provider with this service. If the seam is missing, the
plugin fails explicitly instead of sending undecorated messages whose anchors
cannot be rebuilt from the log.

The client half is a lazy-CJS bundle (`lib/client.js`) declared through
`dsh.client`; it is loaded by the shell's module table and contributes the
sidebar panel.

## 2. Position state

`src/state.ts` replays the session log into a `DecayState`:

- every surface node has a stable `seq`, an optional `messageId`, optional
  `left`/`right` anchor ids, a token estimate, and an optional block record;
- `append` allocates positions; `replace` turns a range into a summary block;
- positions are **ids, not counts**: a compressed range's ids return to a free
  list and can be reused by newer messages. Numeric order does not imply
  message order.
- `nextPosition`, `free`, and `reusedPositions` are rebuilt from the log, so a
  restart produces the same state.

Blocks carry `left`, `right` (`null` for open-ended), tier, summary text, topic,
token count, and source event seqs.

## 3. Decoration and rendering

`src/render.ts` computes one decoration per model-visible message:

- prefix `⟦p<left>⟧ ` for every addressable node;
- suffix ` ⟦p<right>⟧` for a block when no later visible node owns that boundary;
- assistant messages are decorated **only** by rewriting an existing text
  block. A tool-call-only assistant turn has no anchor; that is deliberate,
  because rewriting its index-aligned content could break native replay
  signatures.
- tool calls and their results keep their native ids and order.

Decorations never mutate durable content and never parse anchors from message
text. Text inside a message that looks like `⟦p12⟧` is just content. A leading
run of anchors copied into an assistant reply is stripped both when the request
is built and before the reply is committed; the commit sanitizer is the
`modelMessageDecoration` service's `sanitizeAssistantMessage` hook.

## 4. Compression transaction

`compress` accepts `spans: [{from, to, summary, topic?}]`; `from`/`to` are anchor
texts such as `"⟦p12⟧"` (bare `"p12"` and integer `12` are accepted).

Validation runs before any event is written:

1. parse and normalize each span; strip `⟦p<n>⟧` from summaries;
2. resolve `from` and `to` by node identity (anchor id), never by numeric order;
3. reject a span that includes the current turn, except when "to" is its first
   visible anchor: then keep the unanchored prefix and clip the span to the last
   compressible node;
4. reject a boundary inside an assistant tool-call group. All results of one
   assistant tool-call message must stay in the same span; the plugin does not
   auto-widen;
5. reject overlapping spans; enforce count and summary-length limits;
6. optionally run the miss/payback guards.

When content in the middle must stay live, split into multiple non-overlapping
spans around it instead of covering the live gap; the gap remains visible. Pass
all consumed spans in one call when possible: separate calls invalidate the
prefix again.

A successful compression appends:

```text
compaction/start
compaction/summary
user/message (the summary, via replace)
compaction/end
```

Replay turns the replaced range into a block. Compressing an existing block
again increases its tier and merges boundaries; the summary remains self-contained.

`drop` requires the exact live pair and removes the block with no tombstone.
Freed position ids return to the free list.

## 5. Pressure and reminders

`src/window.ts` resolves the effective window:

```text
effective = total context window - reserved output tokens
```

The total comes from the route/request context; the reservation comes from the
latest request header, then config, then defaults. The model sees pressure as a
fraction of the effective window; the panel also shows total and reservation,
plus a total-window occupancy line for comparison with the built-in context
meter.

`src/prompt.ts` decides reminders:

- a normal reminder after `growthTokens` of growth since the last reminder;
- warnings at the configured `warnRatios` (default 70/81/95%);
- one reminder per level per cooldown window;
- compression re-baselines growth when pressure drops.

Reminders never call `compress`; the model decides. The request guard remains
the hard budget protection.

The bundle patch keeps the official backend mounted with `auto: false` and keeps
the `/compact` command. A manual `/compact` writes an official checkpoint; replay
treats it as ordinary history, not as a context-decay block. It is an emergency
host fallback, not another tier.

## 6. Projection, panel, and audit

`src/projection.ts` registers a `contextDecay` session projection (version 5)
that merges the per-session host runtime snapshot (pressure, reminder, request)
with the replayed block ledger. The checkpoint stores the owning session id, so
each panel reads only its own session's runtime facts; a restored session is
hydrated on first read. The client panel reads the projection; it does not rely
on the built-in context-pressure widget. Position space renders the replay's
surface order reversed: the newest context node is at the top and the earliest
is at the bottom. Anchor ids are identities, not display order.

When `audit` is enabled, a JSONL record is written for each request/compression
to `$DSH_HOME/context-decay/audit.jsonl`. The audit is optional and is not part
of the model-visible context.

## 7. Invariants

- anchors come from replay, not text;
- the current turn is never compressed; its unanchored prefix is kept and the
  span is clipped when "to" names its first visible anchor;
- a tool call and all of its results share one span;
- spans are disjoint and resolved by identity;
- summaries are lossy and are the only surviving record;
- `drop` removes a whole block, never a partial span;
- decorations are presentation-only and are applied identically to the model
  request and the token meter.

## 8. Failure modes

- **Missing host seam:** activation fails with an explicit error.
- **Stale or unknown anchor:** the tool rejects and lists the current visible
  anchors.
- **Tool-group edge:** the tool rejects and explains the group boundary.
- **Current-turn edge:** the tool rejects and names the protected turn.
- **Cost guard:** the tool rejects before writing events and suggests a larger
  span, a later `to`, or a prior `drop`.
- **Corrupt projection state:** the projection rejects the persisted state and
  falls back to host replay.
