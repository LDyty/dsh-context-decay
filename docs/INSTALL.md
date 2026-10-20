# Install (patched host)

[简体中文](INSTALL.zh-CN.md)

This package is **manual-install only**. It is not a drop-in plugin-market
bundle: it requires a local patch to the DSH host. Do not list it in a market
until the `modelMessageDecoration` seam is available upstream.

## Why the patch is required

Stock DSH has no seam for changing the messages sent to the model. This plugin
needs one to present `⟦p<number>⟧` anchors and to make the token meter count the same
decorated text. The patch adds a small `modelMessageDecoration` service and calls
it from the agent loop and token meter. Without the patch, the plugin cannot
present anchors correctly; installation alone is not enough.

The patch is in
[`patches/dsh-model-message-decoration.patch`](../patches/dsh-model-message-decoration.patch).
See [`patches/README.md`](../patches/README.md) for its contract.

## Before you start

- Use a **clean DSH 0.2.1-rc.2 checkout**. Do not patch the checkout that runs
  your daily driver if you cannot rebuild it safely.
- Use a separate profile for testing, for example `web-decay`, so the patched
  host never affects your normal profile by accident.
- Have Git, Node.js >= 22.19, and pnpm available.
- Create a branch or commit in the DSH checkout before applying the patch, so
  rollback is one command.
- Run `npm run check:patch` in the plugin checkout. The host patch must be
  LF-only; a CRLF copy makes `git apply --check` reject every hunk.

## 1. Check the host version

```bash
cd /path/to/deepseek-harness
git status --short
node -p "require('./package.json').version"
```

The expected version is `0.2.1-rc.2`. If it differs, the patch may not apply;
rebase it or use the matching beta revision.

## 2. Apply the patch

```bash
git apply --check /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
git apply /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
git diff --stat
```

The diff should show the message-decoration service, the agent-loop call site,
and the token-meter changes. If `git apply --check` fails, stop: do not force it.
First rule out line endings with `npm run check:patch`; otherwise the checkout
differs from the patch base.

### Windows PowerShell

```powershell
cd G:\develop\ai-projects\deepseek-harness
git apply --check G:\develop\ai-projects\dsh-context-decay\patches\dsh-model-message-decoration.patch
git apply G:\develop\ai-projects\dsh-context-decay\patches\dsh-model-message-decoration.patch
git diff --stat
```

### Verify the seam exists

```bash
grep -n "ModelMessageDecorationService" packages/core/agent-loop/src/message-decoration.ts
grep -n "modelMessageDecoration" packages/core/agent-loop/src/agent.ts
```

Both commands must find a match. If they do not, the patch did not apply.

## 3. Rebuild the host

```bash
pnpm install
pnpm build
```

The rebuilt host is what exposes the seam. Installing the plugin without this
step leaves the system prompt and tools visible, but anchors and pressure
accounting will not be correct.

If you run from a source checkout, use that checkout's CLI:

```bash
pnpm dsh --profile web-decay ...
```

If `dsh` is installed globally, the plain command is enough.

## 4. Build or pack the plugin

If you work from this repository:

```bash
npm install
npm run build
npm test
```

`lib/` contains the host entry, declarations, and the client bundle. If you
build next to a DSH checkout, set `DSH_HARNESS_ROOT` instead of installing
TypeScript locally.

To distribute a tarball without requiring the user to build:

```bash
npm pack
# creates dsh-context-decay-0.1.0.tgz
```

The tarball contains `lib/`, `cordis.patch.yml`, `patches/`, and the docs. Users
install it with the command in the next section.

## 5. Install into a profile

From the plugin checkout:

```bash
dsh plugin --profile web-decay add /path/to/dsh-context-decay
```

Or from the tarball:

```bash
dsh plugin --profile web-decay add ./dsh-context-decay-0.1.0.tgz
```

The package declares `dsh.bundle.patch`, so `dsh plugin` records the bundle and
applies `cordis.patch.yml`:

- disables official automatic compaction (`compaction-basic.auto: false`);
- keeps the manual `/compact` command (`command-compact`);
- disables `tool-result-pruner` and `image-offload` when those rows exist;
- inserts `context-decay`.

`/compact` is a manual host fallback. It writes an official checkpoint, not a
context-decay block; the plugin's panel and position replay treat it as ordinary
history. Use it only when the session is already too large for a normal request.

If your profile does not contain one of those optional rows, remove that block
from `cordis.patch.yml` before installing; a patch that names a missing row can
fail at composition.

### Profiles with presets

The bundle patch only reaches host-plane rows. A shipped preset keeps its own
realm-local `compaction-basic` (auto-compaction enabled) and
`tool-result-pruner`; a profile using that preset can still run a second
reducer beside context-decay. Remove the preset's `compaction` group, or set its
`compaction-basic` `config: { auto: false }` and disable its
`tool-result-pruner`. The plugin cannot patch preset-local rows from its bundle.

## 6. Start and verify

```bash
dsh web --profile web-decay
```

Verify:

1. The system prompt contains `Context decay is enabled for this session.`
2. A new session's model-visible messages show `⟦p<number>⟧` prefixes.
3. `compress` and `drop` are available as tools.
4. The sidebar panel shows pressure, blocks, positions, and request counts.
5. If `audit` is enabled, `$DSH_HOME/context-decay/audit.jsonl` receives records.

The plugin is mounted by the profile that installed it, or by a `--patch` overlay. A separate daily instance launched with another home/profile will not see the panel or tools. `compress` and `drop` are model tools, not sidebar buttons; they appear in chat when the model calls them, while the sidebar only shows the panel.

If you use a custom test launcher, confirm its command carries the same `--patch` overlay (or the profile's own `cordis.patch.yml` contains the inserted row) before debugging the plugin. `--patch` is a global dsh option and must precede web app flags such as `--port`; placing it after `--port` makes the web app reject it with `unknown option '--patch'`.

If anchors are missing, recheck steps 2 and 3 before debugging the plugin.

## Updating or reverting the host

To update DSH, re-apply or rebase the patch on the new checkout, rebuild, then
restart. Keep the patch revision matched to the host version.

To remove everything:

```bash
dsh plugin --profile web-decay remove dsh-context-decay
git -C /path/to/deepseek-harness apply -R /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
pnpm -C /path/to/deepseek-harness build
```

Remove the plugin before reverting the patch; otherwise model requests still
contain decorations the unpatched host does not know about. Existing summary
blocks remain in their session logs; removing the plugin does not rewrite them.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `git apply --check` fails | Wrong DSH revision, local changes, or CRLF line endings; run `npm run check:patch`, then rebase the patch on a clean checkout if it still fails. |
| `git apply --check` fails on every hunk | The patch file has CRLF line endings; use the LF copy and run `npm run check:patch`. |
| Automatic compaction still runs inside a preset | The preset has its own `compaction-basic`; remove or disable the preset compaction group. |
| No anchors on messages | Patch not applied or host not rebuilt; recheck steps 2 and 3. |
| `modelMessageDecoration` unavailable | The seam is missing; apply the patch. |
| Plugin loads but does nothing | `enabled` is false, or the profile patch did not insert the row. |
| Automatic compaction still runs | `compaction-basic.auto` is not `false`; fix the bundle patch. |
| `/compact` unavailable | `command-compact` is disabled or missing from the profile. |
| Client panel missing | The profile lacks the client UI packages, or `lib/client.js` is missing. |
| Sidebar has no Context decay, and tools are missing | The running instance does not mount the plugin: wrong profile/home, missing `--patch` overlay, or profile patch lacks the inserted row. Restart the instance that installed it; a different daily instance does not inherit the plugin. |
| `compress` / `drop` not visible in the sidebar | They are model tools, not sidebar buttons; they appear in chat when the model calls them. The sidebar only shows the panel. |
| `compress` rejects old spans | The span includes the current turn or a tool-call group; pick a boundary outside it. |

## Distribution note

This package is distributed as a manual patched install (checkout or tarball),
not as a marketplace bundle. The manifest keeps `"private": true`; publishing
to npm is a separate release decision. A market index cannot express the
host-patch requirement, and `engines.dsh` cannot distinguish a patched host from
a stock one. If the seam is accepted upstream, the patch step disappears and a
normal market listing becomes possible.
