# 社区目录提交草稿

[English](AWESOME.md) · 简体中文

只有在“需打宿主补丁”的分发方式被接受用于公开目录后，才使用这份草稿。本插件不是一键安装；
任何公开目录条目都必须把宿主补丁要求放在最前面。

## 提交到哪里

社区目录由 [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
维护；`dshmarket` 应用和 `awesome-dsh-plugin.com` 都读取这个 registry。请到**那个仓库**
提 PR 加一条，不要提到 `dsh-market` 应用仓库。

## 条目草稿

```markdown
- [dsh-context-decay](https://github.com/<owner>/dsh-context-decay) — 面向 DeepSeek
  Harness 的模型驱动有损上下文衰减：内联位置锚点、模型选段、自写摘要、显式 drop。
  **需要打 DSH 宿主补丁，不是装上即用的插件。**
```

请保留加粗的宿主补丁说明。不要写成“一键安装”，也不要在条目里只放
`dsh plugin add dsh-context-decay`。

## 向维护者说明

- 本包是手动打补丁安装，`docs/INSTALL.md` 是必读。
- 宿主补丁增加 `modelMessageDecoration` 接缝；原生 DSH 没有这个接缝。
- 市场索引和 `engines.dsh` 无法表达这个前提。
- 支持的发布形式是 tarball + 补丁，不是 `github:` 源码安装。
- 插件有损、不可恢复，这是刻意设计。

如果目录维护者不接受“需改宿主”的插件，这是合理的；仓库和 Release tarball
仍然可以直接分发。

## 如果仍然被收录

条目里的安装说明必须链接到 `docs/INSTALL.md`，用户必须先打补丁并重建宿主再安装。
在原生 DSH 上点一键安装会失败。不要为了条目好看而隐藏补丁步骤。
