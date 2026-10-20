# Release checklist

[简体中文](RELEASE.zh-CN.md)

The local repository is the development source. Publishing to npm or making the
repository public is a separate release decision; do not remove `private` or
publish without explicit approval.

## Distribution mode

This is a **manual patched install**, not a plugin-market bundle. A market index
cannot express the host-patch requirement, and `engines.dsh` cannot distinguish
a patched host from a stock one. Do not generate or publish a market index for
this package. Distribute the checkout or tarball together with the patch
instructions in `docs/INSTALL.md`.

## Before publishing

- [ ] README and README.zh-CN describe the current behavior.
- [ ] `docs/ARCHITECTURE.md` matches the code (anchors, strict tool-group
      rejection, tiers, reminders, projection).
- [ ] `docs/INSTALL.md` applies to the target DSH beta revision.
- [ ] License and package metadata are correct.
- [ ] The host patch requirement is stated prominently.

## Public repository preparation

See [`docs/GITHUB.md`](GITHUB.md) for repository metadata, release assets, the
release-notes template, and the publishing sequence. See
[`docs/AWESOME.md`](AWESOME.md) for a community-catalog entry draft; do not submit
it while the host patch is still required.

- [ ] Remove `"private": true` from `package.json`.
- [ ] Add `repository`, `homepage`, and `bugs` fields with the public URL.
- [ ] Add the final author/copyright line to `LICENSE`.
- [ ] Decide whether the host patch belongs in this repository or a separate
      compatibility branch; document the supported DSH revision.

## Verification

- [ ] `npm install`
- [ ] `npm run build` (host + client, declarations emitted)
- [ ] `npm run check`
- [ ] `npm run prepare:release` (stage the patch into the ignored `release/` directory)
- [ ] `npm run check:patch` (patches/ and release/ are LF-only and identical)
- [ ] `npm test` (all tests pass)
- [ ] `npm pack --dry-run` and inspect the tarball:
  - includes `lib/`, `lib/client.js`, `cordis.patch.yml`, `patches/`,
    `docs/ARCHITECTURE.md`, `docs/INSTALL.md`, `docs/PROMPTS.zh-CN.md`, READMEs, LICENSE;
  - excludes `overlay/`, `logs/`, `tests/`, `src/`, `scripts/`.
  - the packaged `patches/dsh-model-message-decoration.patch` is LF-only;
- [ ] Install the packed tarball into a clean profile on a **patched** DSH
      checkout and verify the panel, tools, anchors, reminders, and audit.
- [ ] Verify the patch applies to a clean 0.2.1-rc.2 checkout, the host
      rebuilds, and the plugin fails loudly on an unpatched host.
- [ ] Verify uninstall/reinstall and replay from an existing session.

## Git and npm

- [ ] Create the public repository only when publishing.
- [ ] Commit the current tree; do not commit machine-local overlays.
- [ ] Push to the chosen remote; do not force-push over an existing public repo.
- [ ] Publish only with explicit approval: `npm publish`.
- [ ] Tag the release after the published tarball is verified.
