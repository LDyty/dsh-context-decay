# GitHub release preparation

[简体中文](GITHUB.zh-CN.md)

This document is a checklist for publishing the repository. It does not create
a repository or push anything by itself.

## Repository identity

| Field | Value |
|---|---|
| Name | `dsh-context-decay` |
| Description | Model-driven, lossy context decay for DeepSeek Harness. Requires a patched DSH host; not a drop-in plugin. |
| Topics | `deepseek-harness`, `dsh`, `dsh-plugin`, `context-compression`, `context-decay`, `compaction`, `llm`, `agent` |
| Default branch | `main` |
| License | MIT |

Do not use a description that implies one-click or marketplace install. The
first line must carry the patched-host requirement.

## README first screen

The first screen should answer, in this order:

1. What it does: model-selected, lossy context compression with inline anchors.
2. How it is installed: manual host patch + bundle/tarball; link to `docs/INSTALL.md`.
3. What it is not: not a drop-in market bundle; no recovery; no automatic compression.
4. Compatibility: DSH 0.2.1-rc.2 with the `modelMessageDecoration` patch.
5. A screenshot: `docs/assets/panel.png` (sidebar panel with pressure,
   reminders, positions, and a summary block).

Do not put a market badge or a one-line install command without the patch
prerequisite beside it.

## What to commit

Commit the source tree and the built `lib/` output:

- `src/`, `client/`, `scripts/`, `tests/`;
- `lib/` (so a checkout is installable without a build toolchain);
- `patches/`, `cordis.patch.yml`, `package.json`, `tsconfig.json`;
- `README*`, `LICENSE*`, `docs/`;
- `docs/GITHUB*` and `docs/AWESOME*` are release-reference docs; they are
  included in the tarball for maintainers but are not loaded by the plugin.

Do not commit:

- `overlay/` (machine-local test overlays);
- `logs/`, `node_modules/`, `*.tgz`, editor/OS files;
- any session log, audit JSONL, or credential.

Run the build and tests before the first commit so `lib/` matches `src/`.

## Version and release assets

- Set `version` in `package.json`.
- Tag format: `v0.1.0`.
- Release title: `dsh-context-decay v0.1.0` (no date in the title).
- Attach:
  - `dsh-context-decay-0.1.0.tgz` from `npm pack`;
  - `dsh-model-message-decoration.patch`;
  - `SHA256SUMS.txt`.

PowerShell checksum example:

```powershell
Get-FileHash .\dsh-context-decay-0.1.0.tgz -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLower())  dsh-context-decay-0.1.0.tgz" } |
  Set-Content SHA256SUMS.txt
```

GitHub's automatically generated source archives are not a substitute for the
built tarball: a source archive has no `lib/` and needs a build.

## Release notes template

```markdown
## dsh-context-decay v0.1.0

Model-driven, lossy context decay for DeepSeek Harness.

### Requirements

- DSH 0.2.1-rc.2 checkout with `patches/dsh-model-message-decoration.patch`
  applied and the host rebuilt.
- Node.js >= 22.19.
- Web profile.

**This is a manual patched install, not a drop-in plugin-market bundle.**
Installing the package without patching and rebuilding the host will not work.

### Install

1. Apply `dsh-model-message-decoration.patch` to the DSH checkout.
2. Run `pnpm install && pnpm build` in that checkout.
3. Install the attached tarball:
   `dsh plugin --profile web add ./dsh-context-decay-0.1.0.tgz`
4. Start `dsh web --profile web` and verify anchors, tools, and the panel.

Full instructions: `docs/INSTALL.md`.

### Notes

- Lossy summaries; no recovery, no decompress, no original-text search.
- The host patch is mandatory; there is no runtime fallback.
```

## Do not use `github:` install for this release

`dsh plugin add github:<owner>/dsh-context-decay` fetches sources and runs a
`prepare` build. This package does not ship a self-contained `prepare` build, so
that path is unsupported. Use the release tarball or a local checkout.

## Sharing after release

- Pin the repository link in the README of related projects and in the release
  notes.
- Open a discussion or issue in the DSH community with the repository link and
  the patched-host requirement; do not present it as a one-click plugin.
- If a community catalog is used, use the draft in `docs/AWESOME.md` and keep the
  patched-host warning first.

## Publishing sequence (after explicit approval)

```bash
git init
git add .
git commit -m "初版"
git branch -M main
git remote add origin <public-url>
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

Create the GitHub release from the tag, attach the assets, and publish the notes.
Do not force-push an existing public repository.
