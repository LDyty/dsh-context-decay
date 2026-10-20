/**
 * Position-anchor presentation and request-boundary cleanup.
 *
 * The model sees `⟦p12⟧`; tools accept that anchor text (or bare `p12`), while
 * integer `12` calls are also valid. Any other bracketed text is ordinary
 * content.
 *
 * 中文：位置锚点的展示与请求边界清理。
 * 模型看到 `⟦p12⟧`；工具接受该锚点文本（或裸 `p12`），整数 `12` 调用也有效。
 * 其他括号文本都是普通内容。
 */
const OPEN = '⟦p';
const CLOSE = '⟧';
const TOKEN = /⟦p(\d+)⟧/;
const LEADING_TOKENS = /^(?:\s*⟦p\d+⟧)+\s*/;
const ALL_TOKENS = /⟦p\d+⟧/g;
const ANCHOR_ARGUMENT = /^\s*(?:⟦p(\d+)⟧|p(\d+)|(\d+))\s*$/;
/**
 * Format one model-visible position anchor.
 * 中文：格式化一个模型可见的位置锚点。
 */
export function formatAnchor(position) {
    return `${OPEN}${position}${CLOSE}`;
}
/**
 * Read the position from an anchor text.
 * 中文：从锚点文本中读出位置。
 */
export function parseAnchor(text) {
    const match = TOKEN.exec(text);
    return match === null ? null : Number(match[1]);
}
/**
 * Parse one tool `from`/`to` argument into a position id.
 *
 * Accepts the visible anchor text (`⟦p12⟧`), a bare anchor (`p12`), a decimal
 * string (`"12"`), or the integer `12`. Returns null for anything else.
 *
 * 中文：把一个工具 `from`/`to` 参数解析成位置 id。
 * 接受可见锚点文本（`⟦p12⟧`）、裸锚点（`p12`）、十进制字符串（`"12"`）或整数 `12`；
 * 其他值返回 null。
 */
export function parseAnchorArgument(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value !== 'string')
        return null;
    const match = ANCHOR_ARGUMENT.exec(value);
    if (match === null)
        return null;
    const position = Number(match[1] ?? match[2] ?? match[3]);
    return Number.isSafeInteger(position) ? position : null;
}
/**
 * Parse a `to`-style bound: an anchor argument or the literal `"end"`.
 * 中文：解析 `to` 边界：锚点参数或字面量 `"end"`。
 */
export function parseAnchorBound(value) {
    if (value === 'end')
        return 'end';
    return parseAnchorArgument(value);
}
/**
 * Remove a leading run of copied anchors from an assistant message.
 * 中文：去掉 assistant 消息开头连续复制的锚点。
 */
export function stripLeadingAnchors(text) {
    return text.replace(LEADING_TOKENS, '');
}
/**
 * Remove every anchor token from a summary; the summary must not bake one in.
 * 中文：从摘要中移除所有锚点；摘要里不能写入锚点。
 */
export function stripAnchors(text) {
    return text.replace(ALL_TOKENS, ' ').replace(/[ \t]+/g, ' ').trim();
}
