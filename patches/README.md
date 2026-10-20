# Host patch: model request message decoration seam

[简体中文](README.zh-CN.md)

This patch adds the minimal host seam that lets a plugin decorate the messages
sent to the model and sanitize an assistant reply before it is committed. The
session log only receives the sanitized reply.

- **Baseline:** DeepSeek Harness 0.2.1-rc.2 (`687f282e86`). The patch also
  applies to `3cdd553ac8`; that commit only changes `llm-deepseek` tool-argument
  parsing.
- **Patch file:** `dsh-model-message-decoration.patch`.
- **Shape:** 5 files, +90 / -14.
- **Request assembly:** a plugin can add `⟦p12⟧`-style anchors to the request.
- **Commit sanitizer:** a plugin can strip a leading run of its own anchors from
  an assistant reply before `assistant/message` is appended.

## What it adds

1. **`ModelMessageDecorationService`** in
   `packages/core/agent-loop/src/message-decoration.ts`:
   - `decorate(session, messages) => messages`;
   - optional `tokenOverhead?(session): number` for the token meter;
   - optional `sanitizeAssistantMessage?(session, message): message` for the
     assistant commit path.
2. **Agent request assembly:** `buildRequest()` calls `decorate()` after
   `deriveMessages()` and before the request is frozen and sent. If no provider
   is registered, the original array passes through unchanged. A provider error
   fails the request; there is no silent fallback.
3. **Assistant commit:** before `assistant/message` is appended, the loop calls
   `sanitizeAssistantMessage()` when present. The sanitized message is the
   durable one; the raw stream is not rewritten.
4. **Token meter:** `measure()` adds `tokenOverhead(session)` to the heuristic
   baseline and returns `decorationOverheadTokens`. The usage baseline already
   contains the decorated text, so it is not double-counted. `surfaceTokens`
   stays a pure surface measure.
5. **Token-meter test:** the full measurement assertion includes the new field.

## Line endings

The patch file is stored with LF line endings. A CRLF copy makes `git apply`
report every hunk as mismatched on an LF checkout. Run `npm run check:patch`
before applying or distributing it; the check also requires the `patches/` and
`release/` copies to be byte-identical.

## Apply

```bash
cd /path/to/deepseek-harness
git apply --check /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
git apply /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
pnpm install
pnpm build
```

Revert:

```bash
git -C /path/to/deepseek-harness apply -R /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
```

If the check fails, the checkout differs from the patch base. Rebase the patch
against the matching DSH revision instead of forcing it.

## Contract

- Default off: with no provider registered, the request and session log are
  byte-identical; the meter only gains `decorationOverheadTokens: 0`.
- Presentation and sanitizers only: no user/tool content is rewritten; a copied
  leading anchor is removed from the assistant reply before commit.
- The sanitizer is deterministic and limited to a leading run of anchor tokens.
- Deterministic: the same session and rules produce the same decoration, and the
  text must be rebuildable from the log.
- `tokenOverhead` is a pure function with no I/O; the meter calls it on each
  `measure()`.
- Keep the patch minimal when rebasing; a large conflict means it has grown
  beyond the seam.
