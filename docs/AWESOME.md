# Community catalog submission draft

[简体中文](AWESOME.zh-CN.md)

Use this only after the host-patch distribution has been accepted for a public
catalog. The plugin requires a patched DSH host; it is not a one-click install,
and a general catalog entry must say so before anything else.

## Where to submit

The community catalog is curated in
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
The `dshmarket` app and `awesome-dsh-plugin.com` read that registry. Submit one
entry with a PR **there**, not in the `dsh-market` app repository.

## Entry draft

```markdown
- [dsh-context-decay](https://github.com/<owner>/dsh-context-decay) — Model-driven,
  lossy context decay for DeepSeek Harness: inline position anchors, model-selected
  spans, self-written summaries, explicit drop. **Requires a patched DSH host; not
  a drop-in plugin.**
```

Keep the patched-host sentence in bold. Do not describe it as one-click, and do
not put a bare `dsh plugin add dsh-context-decay` command in the entry.

## What to tell a maintainer

- The package is a manual patched install: `docs/INSTALL.md` is mandatory reading.
- The host patch adds a `modelMessageDecoration` seam; stock DSH does not expose it.
- Marketplace indexes and `engines.dsh` cannot express this prerequisite.
- The supported release is a tarball plus the patch, not `github:` source install.
- The plugin is lossy and has no recovery; this is intentional.

If the catalog declines a patched-host plugin, that is reasonable. The
repository and release tarball remain available directly.

## If listed anyway

The install instructions in the entry must link to `docs/INSTALL.md`; users must
patch and rebuild the host before installing. A one-click install will fail on
stock DSH. Do not hide the patch step to make the entry look simpler.
