# 宿主补丁：模型请求消息装饰接缝

[English](README.md) · 简体中文

本补丁增加一个最小的宿主接缝，让插件可以装饰发给模型的消息，并在 assistant 回复落盘前清理它复制过来的锚点。会话日志只接收清理后的回复。

- **基线**：DeepSeek Harness 0.2.1-rc.2（`687f282e86`）；补丁也可应用到
  `3cdd553ac8`，该 commit 仅改动 `llm-deepseek` 的工具参数解析。
- **补丁文件**：`dsh-model-message-decoration.patch`。
- **规模**：5 个文件，+90 / -14。
- **请求组装**：插件可以给请求加 `⟦p12⟧` 形式的锚点。
- **落盘清理**：插件可以在 `assistant/message` 追加前剥离开头连续的自有锚点。

## 增加的内容

1. **`ModelMessageDecorationService`**，位于
   `packages/core/agent-loop/src/message-decoration.ts`：
   - `decorate(session, messages) => messages`；
   - 可选 `tokenOverhead?(session): number`，供 token meter 使用；
   - 可选 `sanitizeAssistantMessage?(session, message): message`，供 assistant 落盘路径使用。
2. **agent 请求组装**：`buildRequest()` 在 `deriveMessages()` 之后、请求冻结并发送之前
   调用 `decorate()`。没有提供者时原数组直通；提供者抛错会让请求失败，不会静默降级。
3. **assistant 落盘**：在追加 `assistant/message` 之前，若存在 `sanitizeAssistantMessage()`
   就调用；落盘的是清理后的消息，原始流不重写。
4. **token meter**：`measure()` 把 `tokenOverhead(session)` 加到 heuristic baseline，
   并返回 `decorationOverheadTokens`。usage baseline 已经包含装饰文本，不会重复计价。
   `surfaceTokens` 仍是纯 surface 口径。
5. **token-meter 测试**：完整 measurement 断言包含新字段。

## 行尾

补丁必须以 LF 保存。CRLF 副本会让 `git apply` 在 LF checkout 上把每个 hunk 都
判为上下文不匹配。应用或分发前在插件目录运行 `npm run check:patch`；该检查还要求
`patches/` 与 `release/` 两份补丁逐字节一致。

## 应用

```bash
cd /path/to/deepseek-harness
git apply --check /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
git apply /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
pnpm install
pnpm build
```

撤销：

```bash
git -C /path/to/deepseek-harness apply -R /path/to/dsh-context-decay/patches/dsh-model-message-decoration.patch
```

如果 check 失败，说明 checkout 与补丁基线不同；请针对匹配的 DSH 版本 rebase，
不要强行应用。

## 契约

- 默认关闭：没有提供者时，请求和会话日志逐字节一致；meter 只多出
  `decorationOverheadTokens: 0`。
- 只做展示与清理：不改用户/tool 内容；assistant 回复开头被复制的锚点会在落盘前移除。
- 清理是确定性的，只针对开头连续的锚点 token。
- 确定性：同一会话 + 同一规则产生同一装饰，文本必须能从日志重建。
- `tokenOverhead` 是纯函数、无 I/O；meter 每次 `measure()` 重新调用。
- rebase 时保持补丁最小；冲突变大说明它超出了接缝范围。
