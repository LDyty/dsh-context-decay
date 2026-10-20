/**
 * Deterministic replay of the Session surface into position anchors and summary
 * blocks.
 *
 * The presentation layer never stores positions in the session format: every
 * position here is a pure function of the committed surface operations
 * (append / replace). Positions are ids, not surface indices: an append takes
 * the lowest free id (released when a replacement stops referencing it), so
 * ids can reappear on newer messages. A position stays reserved while any live
 * node references it as a left anchor or as a summary block's right boundary
 * (shared boundaries are refcounted).
 *
 * 中文：把 Session surface 确定性重放成位置锚点和摘要块。
 * 展示层从不把位置写进 session 格式：这里每个位置都是已提交 surface 操作
 * （append / replace）的纯函数。位置是 id，不是 surface 下标：append 取最小的空闲 id
 * （replacement 不再引用它时释放），所以 id 可能重新出现在更新的消息上。任何 live
 * 节点把它当左锚点或摘要块右边界引用时，位置保持 reserved（共享边界按引用计数）。
 */
/**
 * One event that produced a derived message.
 * 中文：产生一条派生消息的事件。
 */
export function observedMessageOf(event) {
    if (!isRecord(event.data))
        return null;
    const raw = event.type === 'user/message' ? event.data : event.data['message'];
    if (!isRecord(raw))
        return null;
    const message = raw;
    if (typeof message.id !== 'string' || typeof message.role !== 'string' || !Array.isArray(message.content))
        return null;
    return { message, source: isRecord(message.source) ? message.source : {} };
}
/**
 * Whether a message can carry a `⟦p12⟧` anchor without breaking durable replay metadata.
 * 中文：一条消息能否携带 `⟦p12⟧` 锚点而不破坏持久 replay 元数据。
 */
export function isAnchorable(message) {
    if (message.role === 'user' || message.role === 'tool')
        return true;
    // Assistant replay metadata (thinking signatures) is index-aligned per content
    // block, so an assistant message may only be decorated when it already has a
    // text block whose text can be rewritten in place.
    // 中文：assistant 的 replay 元数据（thinking 签名）按 content 块索引对齐，所以只有
    // 已经存在可原地改写 text 块时，才能给 assistant 消息加锚点。
    return message.role === 'assistant' && message.content.some(block => block.type === 'text');
}
/**
 * Whether a surface event derives a model-visible message.
 * 中文：一个 surface 事件是否派生模型可见消息。
 */
function derivesMessage(message) {
    if (message.role === 'user' || message.role === 'tool')
        return true;
    return message.role === 'assistant' && message.content.length > 0;
}
/**
 * A fresh state before any event is folded.
 * 中文：尚未折叠任何事件时的初始状态。
 */
export function createState(sessionId) {
    return {
        ...(sessionId === undefined ? {} : { sessionId }),
        applied: 0,
        nextPosition: 0,
        free: [],
        refs: {},
        nodes: [],
        openTurn: null,
        step: 0,
        turnStartSeq: -1,
        lastReminderTurn: null,
        lastReminderTokens: 0,
        lastReminderLevel: 0,
        usage: null,
        blocksCreated: 0,
        assistantRequests: 0,
        reusedPositions: 0,
    };
}
/**
 * Heap-stable in-memory replay cache keyed by the live Session object.
 * 中文：以 live Session 对象为 key 的堆稳定内存重放缓存。
 */
export class StateCache {
    states = new WeakMap();
    /**
     * Fold the session's committed tail into its cached state.
     * 中文：把 session 已提交的尾部事件折叠进缓存状态。
     */
    stateOf(session) {
        const events = session.snapshotEvents();
        const state = this.states.get(session) ?? createState();
        for (let index = state.applied; index < events.length; index += 1) {
            foldEvent(state, events[index]);
        }
        state.applied = events.length;
        this.states.set(session, state);
        return state;
    }
}
/**
 * Fold the whole event array (tests and one-shot reconstruction).
 * 中文：折叠整个事件数组（测试和一次性重建用）。
 */
export function foldAll(events) {
    const state = createState();
    for (const event of events)
        foldEvent(state, event);
    state.applied = events.length;
    return state;
}
/**
 * Apply one committed event to the replay state in place.
 * 中文：把一个已提交事件原地应用到重放状态。
 */
export function foldEvent(state, event) {
    if (event.type === 'turn/start') {
        state.openTurn = turnOf(event) ?? null;
        state.turnStartSeq = event.seq;
        state.step = 0;
        return;
    }
    if (event.type === 'turn/end') {
        state.openTurn = null;
        return;
    }
    if (event.type === 'step/start') {
        state.step = stepOf(event) ?? state.step;
        return;
    }
    if (event.type === 'assistant/message') {
        state.assistantRequests += 1;
        recordUsage(state, event);
    }
    const observed = observedMessageOf(event);
    if (observed !== null) {
        const source = observed.source;
        if (source['kind'] === 'context-decay' && source['form'] === 'notice') {
            state.lastReminderTurn = state.openTurn;
            state.lastReminderTokens = typeof source['atTokens'] === 'number' ? source['atTokens'] : 0;
            state.lastReminderLevel = typeof source['level'] === 'number' ? source['level'] : 0;
        }
    }
    const op = event.surfaceOp;
    if (op === undefined || observed === null)
        return;
    const message = observed.message;
    if (op === 'append') {
        appendNode(state, event, message);
        return;
    }
    replaceNode(state, event, message, op.startSeq, op.endSeq);
}
/**
 * Append one surface node, allocating the lowest free position when addressable.
 * 中文：追加一个 surface 节点；可寻址时分配最小空闲位置。
 */
function appendNode(state, event, message) {
    if (!derivesMessage(message)) {
        state.nodes.push(invisibleNode(state, event, message, true));
        return;
    }
    const anchorable = isAnchorable(message);
    const left = anchorable ? allocatePosition(state) : null;
    if (left !== null)
        closeTailBlocks(state, left);
    state.nodes.push(nodeOf(state, event, message, left, false, null, 0, true));
}
/**
 * Take the lowest free position, or append a fresh id; both paths reserve one reference.
 * 中文：取最小空闲位置，或追加一个新 id；两条路径都预留一个引用。
 */
function allocatePosition(state) {
    const reused = state.free.shift();
    const left = reused ?? state.nextPosition++;
    if (reused !== undefined)
        state.reusedPositions += 1;
    bumpRef(state, left);
    return left;
}
/**
 * Reserve one reference to a position.
 * 中文：给一个位置预留一个引用。
 */
function bumpRef(state, position) {
    state.refs[position] = (state.refs[position] ?? 0) + 1;
}
/**
 * Replay one recorded surface replacement.
 * 中文：重放一次已记录的 surface replacement。
 */
function replaceNode(state, event, message, startSeq, endSeq) {
    const startIdx = state.nodes.findIndex(node => node.seq === startSeq);
    const endIdx = state.nodes.findIndex(node => node.seq === endSeq);
    if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) {
        throw new Error(`context-decay: surface replace at log seq ${event.seq} names range ${startSeq}..${endSeq}, `
            + 'which the replayed surface does not contain (corrupt or foreign surface operation)');
    }
    const shadowed = state.nodes.slice(startIdx, endIdx + 1);
    const source = isRecord(message.source) ? message.source : {};
    const summary = source['kind'] === 'context-decay' && source['form'] === 'summary';
    const anchorable = derivesMessage(message) && isAnchorable(message);
    const firstAnchorable = shadowed.find(node => node.left !== null);
    const firstLeft = firstAnchorable?.left ?? null;
    let replacement;
    if (summary && anchorable && firstLeft !== null) {
        const last = shadowed[shadowed.length - 1];
        const right = last !== undefined && last.block ? last.right : nextAnchorableLeft(state.nodes, endIdx + 1);
        const innerTier = shadowed.reduce((max, node) => node.block ? Math.max(max, node.tier) : max, 0);
        replacement = nodeOf(state, event, message, firstLeft, true, right, innerTier + 1, false);
        state.blocksCreated += 1;
        closeTailBlocksBefore(state, startIdx, firstLeft);
    }
    else if (anchorable && firstLeft !== null) {
        // In-place content rewrite (tool-result pruning, image offload, …): keep the slot.
        // 中文：原地改写内容（tool result 裁剪、图片 offload 等）：保留原来的位置槽。
        const only = shadowed.length === 1 ? shadowed[0] : undefined;
        if (only !== undefined && only.block) {
            replacement = {
                ...nodeOf(state, event, message, firstLeft, true, only.right, only.tier, false),
                createdAtTurn: only.createdAtTurn,
            };
        }
        else {
            replacement = nodeOf(state, event, message, firstLeft, false, null, 0, false);
        }
    }
    else {
        replacement = invisibleNode(state, event, message, false);
    }
    state.nodes.splice(startIdx, endIdx - startIdx + 1, replacement);
    recomputeReferences(state);
}
/**
 * Rebuild the reference counts and the free list from the current nodes.
 *
 * Replacements are rare (compressions, drops, in-place rewrites), so a full
 * rebuild keeps the invariant obvious: a position is free exactly when no live
 * node uses it as a left anchor or as a summary block's right boundary.
 *
 * 中文：根据当前节点重建引用计数和空闲列表。
 * replacement 很少（压缩、drop、原地改写），所以全量重建能让不变量保持直观：
 * 一个位置空闲，当且仅当没有任何 live 节点把它当左锚点或摘要块右边界。
 */
function recomputeReferences(state) {
    const refs = {};
    const bump = (position) => {
        refs[position] = (refs[position] ?? 0) + 1;
    };
    for (const node of state.nodes) {
        if (node.left !== null)
            bump(node.left);
        if (node.block && node.right !== null)
            bump(node.right);
    }
    const free = [];
    for (let position = 0; position < state.nextPosition; position += 1) {
        if (refs[position] === undefined)
            free.push(position);
    }
    state.refs = refs;
    state.free = free;
}
/**
 * Close every trailing end-block before newly appended content starts at `left`.
 * 中文：新追加内容从 `left` 开始时，关闭所有尾部未闭合块。
 */
function closeTailBlocks(state, left) {
    closeTailBlocksBefore(state, state.nodes.length, left);
}
/**
 * Close trailing end-blocks strictly before `beforeIdx`.
 * 中文：关闭严格位于 `beforeIdx` 之前的尾部未闭合块。
 */
function closeTailBlocksBefore(state, beforeIdx, left) {
    for (let index = beforeIdx - 1; index >= 0; index -= 1) {
        const node = state.nodes[index];
        if (node.left === null)
            continue;
        if (node.block && node.right === null) {
            state.nodes[index] = { ...node, right: left };
            // Appends rely on the incremental count; replacements rebuild it after the splice.
            // 中文：append 路径依赖这里的增量计数；replacement 会在 splice 之后全量重建。
            bumpRef(state, left);
        }
        return;
    }
}
/**
 * First anchorable position at or after `fromIdx`, or null at the end.
 * 中文：`fromIdx` 起第一个可锚定位置；到末尾仍没有则为 null。
 */
function nextAnchorableLeft(nodes, fromIdx) {
    for (let index = fromIdx; index < nodes.length; index += 1) {
        const left = nodes[index]?.left;
        if (left !== undefined && left !== null)
            return left;
    }
    return null;
}
/**
 * Build a node record for one surface event.
 * 中文：为一个 surface 事件构造节点记录。
 */
function nodeOf(state, event, message, left, block, right, tier, appended) {
    const source = isRecord(message.source) ? message.source : {};
    return {
        seq: event.seq,
        left,
        messageId: message.id,
        role: message.role,
        block,
        right,
        tier,
        createdAtTurn: state.openTurn,
        tokens: estimateMessageTokens(message),
        summaryChars: block ? textLength(message.content) : 0,
        topic: typeof source['topic'] === 'string' ? source['topic'] : null,
        toolCalls: message.content.reduce((count, item) => item.type === 'tool-call' ? count + 1 : count, 0),
        toolResult: message.role === 'tool',
        appended,
    };
}
/**
 * Build a node that projects no model-visible message.
 * 中文：构造一个不投影模型可见消息的节点。
 */
function invisibleNode(state, event, message, appended) {
    return nodeOf(state, event, message, null, false, null, 0, appended);
}
/**
 * Estimate model-visible tokens of one message (mirrors the harness token meter's fixed heuristic).
 * 中文：估算一条消息的模型可见 token 数（复刻宿主 token meter 的固定启发式）。
 */
export function estimateMessageTokens(message) {
    if (message.role === 'system') {
        if (message.content.length === 0)
            return 0;
        let characters = 0;
        for (const block of message.content) {
            characters += block.type === 'text' && typeof block.text === 'string' ? block.text.length : JSON.stringify(block).length;
        }
        return Math.ceil(characters / 4) + 4;
    }
    return 4 + message.content.reduce((sum, block) => sum + estimateBlockTokens(block), 0);
}
/**
 * Estimate tokens of one content block (same fixed heuristic as the harness token meter).
 * 中文：估算一个 content 块的 token 数（与宿主 token meter 相同的固定启发式）。
 */
export function estimateBlockTokens(block) {
    switch (block.type) {
        case 'text':
        case 'reasoning':
            return Math.ceil((typeof block.text === 'string' ? block.text.length : 0) / 4) + 4;
        case 'tool-call': {
            const name = typeof block.name === 'string' ? block.name : '';
            const args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? '');
            return Math.ceil(name.length / 4) + Math.ceil(args.length / 4) + 4;
        }
        default:
            return 4 + Math.ceil(JSON.stringify(block).length / 4);
    }
}
/**
 * Estimate tokens of plain text: ASCII prose ≈ 4 chars/token, other scripts ≈ 1 char/token.
 * 中文：估算纯文本 token 数：ASCII 文本约 4 字符/token，其他文字约 1 字符/token。
 */
export function estimateTextTokens(text) {
    if (text.length === 0)
        return 0;
    let ascii = 0;
    let other = 0;
    for (const char of text) {
        if (char.charCodeAt(0) < 0x80)
            ascii += 1;
        else
            other += 1;
    }
    return Math.ceil(ascii / 4) + other;
}
/**
 * Sum of visible text characters in a block list.
 * 中文：一个块列表里可见文本字符的总数。
 */
function textLength(content) {
    return content.reduce((sum, block) => sum + (block.type === 'text' && typeof block.text === 'string' ? block.text.length : 0), 0);
}
/**
 * Record the latest assistant usage snapshot.
 * 中文：记录最新 assistant 的用量快照。
 */
function recordUsage(state, event) {
    if (!isRecord(event.data) || !isRecord(event.data['usage']))
        return;
    const usage = event.data['usage'];
    const read = (key) => typeof usage[key] === 'number' ? usage[key] : 0;
    state.usage = {
        inputTokens: read('inputTokens'),
        cacheReadTokens: read('cacheReadTokens'),
        cacheWriteTokens: read('cacheWriteTokens'),
        outputTokens: read('outputTokens'),
    };
}
/**
 * Turn number of a `turn/*` event.
 * 中文：`turn/*` 事件的回合号。
 */
function turnOf(event) {
    if (!isRecord(event.data))
        return undefined;
    return typeof event.data['turn'] === 'number' ? event.data['turn'] : undefined;
}
/**
 * Step number of a `step/*` event.
 * 中文：`step/*` 事件的步骤号。
 */
function stepOf(event) {
    if (!isRecord(event.data))
        return undefined;
    return typeof event.data['step'] === 'number' ? event.data['step'] : undefined;
}
/**
 * Narrow an unknown value to a plain JSON object.
 * 中文：把 unknown 收窄为普通 JSON 对象。
 */
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
