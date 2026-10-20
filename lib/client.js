window.__ModuleLoader__.load({ id: "dsh-context-decay", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
//#region client/index.jsx
/**
* Browser half of dsh-context-decay: a right-Sidebar tab that draws the live
* position space as an animated diagram.
*
* Data arrives through the host `contextDecay` session projection (a pure
* replay fold, with the host runtime pressure/reminder/request snapshot merged
* into every view). This bundle has no runtime dependency beyond React from the
* shell module table.
*
* 中文：dsh-context-decay 的浏览器端：右侧栏标签页，用动画图画出 live 位置空间。
* 数据来自宿主 `contextDecay` session projection（纯重放 fold，宿主运行时的压力/提醒/请求
* 快照会合并进每个视图）。除 shell 模块表提供的 React 外，本 bundle 没有运行时依赖。
*/
/**
* Package row id (must equal package.json name) and this tab type's identity.
* 中文：包行 id（必须等于 package.json 的 name）以及本标签类型身份。
*/
const ID = "dsh-context-decay/panel";
const KIND = "context-decay";
const NS = "contextDecay";
/**
* Ghost rows are transient removal animations; cap them so one large fold
* cannot briefly stretch the scroll area.
* 中文：ghost 行是短暂的移除动画；限制数量，避免一次大折叠短暂撑高滚动区。
*/
const GHOST_NODE_LIMIT = 6;
/**
* Locale dictionaries (model-facing copy is English; this is user-facing chrome).
* 中文：语言字典（模型可见文案是英文；这里是用户界面文案）。
*/
const en = {
	"type.title": "Context decay",
	"guide.title": "Context decay",
	"guide.description": "Animated map of anchors, summary blocks, reuse and pressure",
	"panel.title": "Context decay",
	"panel.subtitle": "live position map",
	"panel.pressure": "Context pressure (effective window)",
	"panel.waiting": "Waiting for the session snapshot…",
	"panel.empty": "No visible messages yet.",
	"panel.allocated": "allocated",
	"panel.free": "free",
	"panel.reused": "reused",
	"panel.visible": "visible",
	"panel.blocks": "blocks",
	"panel.windowLine": "total {total} − output reserve {reserve} = effective {effective}",
	"panel.occupancyLine": "total-window occupancy {percent}% · {used} / {total}",
	"panel.reminders": "Reminders",
	"panel.level": "level",
	"panel.thresholds": "thresholds",
	"panel.lastReminder": "last reminder",
	"panel.growth": "growth since last",
	"panel.nextGrowth": "next growth at",
	"panel.lastRequest": "Last request",
	"panel.messages": "messages",
	"panel.anchors": "anchors",
	"panel.overhead": "anchor overhead",
	"source.meter": "meter",
	"source.usage": "provider usage",
	"source.estimate": "local estimate",
	"stat.allocated": "Allocated",
	"stat.free": "Free",
	"stat.reused": "Reused",
	"stat.visible": "Visible",
	"stat.blocks": "Blocks",
	"panel.timeline": "Position space",
	"panel.turn": "turn {turn}",
	"panel.protected": "protected",
	"panel.foldable": "compressible ≤ #{end}",
	"panel.freeIds": "Free position ids",
	"panel.summary": "summary block",
	"panel.fold": "compressed {pair} → tier {tier}",
	"panel.drop": "dropped {pair}",
	"panel.append": "appended #{id}",
	"panel.mechanism": "Mechanism",
	"panel.mechanismCaption": "Compressed positions become a summary block. Dropping it frees its ids; the next messages reuse them lowest-first, so anchors are ids, not order.",
	"panel.live": "live",
	"panel.offline": "no projection",
	"role.user": "user",
	"role.assistant": "assistant",
	"role.tool": "tool",
	"role.other": "other",
	"tip.pressure": "Share of the effective window (total − output reserve) that the next request would use. The reminder uses the same reading.",
	"tip.window": "Effective window = total route capacity − output reservation (request/header.config.maxTokens).",
	"tip.occupancyLine": "Same total-window denominator as the built-in context meter; the effective pressure above drives reminders.",
	"tip.reminders": "Four reminder tiers: growth steps plus 70/81/95% pressure warnings.",
	"tip.level": "Highest warning level announced so far. It re-arms after pressure drops below the level.",
	"tip.thresholds": "Configured pressure ratios. Each fires once per upward crossing.",
	"tip.lastReminder": "Turn and token count of the most recent reminder.",
	"tip.growth": "Tokens grown since the last reminder; the next normal reminder is due at the next-growth count.",
	"tip.nextGrowth": "Absolute token count at which the next growth reminder becomes due.",
	"tip.request": "Ordinal of the last decorated request in this session; durable across process restarts.",
	"tip.messages": "Messages in the last decorated request.",
	"tip.anchors": "Inline position anchors in that request.",
	"tip.blocks": "Live summary blocks at that request.",
	"tip.overhead": "Estimated tokens the anchor decoration added to that request.",
	"tip.allocated": "Highest position id allocated so far; ids are reused.",
	"tip.free": "Released ids available for the next appended message.",
	"tip.reused": "Appends that took a released id instead of a fresh one.",
	"tip.visible": "Live model-visible nodes that carry an anchor.",
	"tip.statsBlocks": "Live summary blocks on the surface.",
	"tip.timeline": "Live positions in context order: the newest message is at the top; scroll down for earlier messages. Anchor ids are identities, not order.",
	"tip.freeIds": "Released ids; the next appended message takes the lowest one.",
	"tip.anchor": "Position id. It is an identity, not an order: newer messages can reuse smaller ids.",
	"tip.tier": "Compression tier: re-compressing the same pair adds one.",
	"tip.ticker": "Recent compressions, drops, and appends.",
	"tip.protected": "The current turn is protected and cannot be compressed.",
	"tip.foldable": "Last position that may be compressed in this request."
};
const zh = {
	"type.title": "Context decay（上下文衰减）",
	"guide.title": "Context decay（上下文衰减）",
	"guide.description": "锚点、摘要块、位置复用与压力的动画图解",
	"panel.title": "Context decay（上下文衰减）",
	"panel.subtitle": "Live position map（实时位置图谱）",
	"panel.pressure": "Context pressure（有效窗口压力）",
	"panel.waiting": "Waiting…（等待会话快照…）",
	"panel.empty": "No visible messages（还没有可见消息）",
	"panel.allocated": "Allocated（已分配）",
	"panel.free": "Free（空闲）",
	"panel.reused": "Reused（已复用）",
	"panel.visible": "Visible（可见）",
	"panel.blocks": "Blocks（摘要块）",
	"panel.windowLine": "Total（总窗口） {total} − Output reserve（输出预留） {reserve} = Effective（有效） {effective}",
	"panel.occupancyLine": "总窗口占用 {percent}% · {used} / {total}",
	"panel.reminders": "Reminders（提醒状态）",
	"panel.level": "Level（当前层级）",
	"panel.thresholds": "Thresholds（阈值）",
	"panel.lastReminder": "Last reminder（上次提醒）",
	"panel.growth": "Growth since last（距上次增长）",
	"panel.nextGrowth": "Next growth at（下次增长提醒）",
	"panel.lastRequest": "Session request（本会话请求）",
	"panel.messages": "Messages（消息）",
	"panel.anchors": "Anchors（锚点）",
	"panel.overhead": "Anchor overhead（锚点开销）",
	"source.meter": "meter",
	"source.usage": "provider usage",
	"source.estimate": "本地估算",
	"stat.allocated": "Allocated",
	"stat.free": "Free",
	"stat.reused": "Reused",
	"stat.visible": "Visible",
	"stat.blocks": "Blocks",
	"panel.timeline": "Position space（位置空间）",
	"panel.turn": "Turn（第 {turn} 回合）",
	"panel.protected": "Protected（受保护）",
	"panel.foldable": "Compressible（可压缩）≤ #{end}",
	"panel.freeIds": "Free ids（空闲位置 id）",
	"panel.summary": "Summary block（摘要块）",
	"panel.fold": "压缩 {pair} → 层级 {tier}",
	"panel.drop": "丢弃 {pair}",
	"panel.append": "追加 #{id}",
	"panel.mechanism": "Mechanism（机制图解）",
	"panel.mechanismCaption": "被压缩的位置变成一个摘要块。丢弃它释放这些 id；后续消息按最低空闲优先复用，所以锚点是 id，不是顺序号。",
	"panel.live": "Live（实时）",
	"panel.offline": "Offline（无投影）",
	"role.user": "用户",
	"role.assistant": "助手",
	"role.tool": "工具",
	"role.other": "其他",
	"tip.pressure": "下一次请求占有效窗口（总窗口 − 输出预留）的比例；与提醒使用同一读数。",
	"tip.window": "有效窗口 = 总窗口 − 输出预留（来自 request/header.config.maxTokens）。",
	"tip.occupancyLine": "与内置上下文进度使用同一个总窗口分母；上面的有效窗口压力用于提醒。",
	"tip.reminders": "四级提醒：增长步长 + 70/81/95% 三个压力档。",
	"tip.level": "已播报的最高警告层级；压力回落后自动重新武装。",
	"tip.thresholds": "配置的压力比例；每档只在向上跨过时触发一次。",
	"tip.lastReminder": "最近一次提醒所在回合与当时的 token 数。",
	"tip.growth": "距上次提醒增长了多少 token；到 next growth 数值时触发下一次普通提醒。",
	"tip.nextGrowth": "下一次普通提醒的绝对 token 触发点。",
	"tip.request": "本会话第 N 次被装饰的模型请求；跨进程重启保持连续。",
	"tip.messages": "该次请求中的消息数。",
	"tip.anchors": "该次请求中的内联位置锚点数。",
	"tip.blocks": "该次请求时的活动摘要块数。",
	"tip.overhead": "该次请求锚点装饰估算增加的 token。",
	"tip.allocated": "已分配到的最高位置 id；id 会复用，不代表消息数。",
	"tip.free": "已释放、可被下一条 append 消息使用的 id。",
	"tip.reused": "使用已释放 id 的 append 次数。",
	"tip.visible": "当前带锚点的模型可见节点数。",
	"tip.statsBlocks": "当前 surface 上的活动摘要块数。",
	"tip.timeline": "实时位置按上下文顺序排列：最新的消息在最上面，向下滚动查看更早的消息。锚点 id 是身份，不代表顺序。",
	"tip.freeIds": "已释放的 id；下一条 append 消息取最小的一个。",
	"tip.anchor": "位置 id 是身份而不是顺序：较新的消息可能复用更小的 id。",
	"tip.tier": "压缩层级：同一 pair 再压缩一次加一层。",
	"tip.ticker": "最近的压缩、丢弃与追加事件。",
	"tip.protected": "当前回合受保护，不能被压缩。",
	"tip.foldable": "本次请求中最后一个可压缩的位置。"
};
/**
* One-shot animation classes and layout, tagged so disposal removes it.
* 中文：一次性动画类和布局；带标记，dispose 时可以准确移除。
*/
const STYLE = `
.dcd-root { display:flex; flex-direction:column; gap:10px; height:100%; padding:12px; overflow:auto; color:inherit; font-size:12px; line-height:1.45; }
.dcd-head { display:flex; flex-direction:column; gap:2px; }
.dcd-title { display:flex; align-items:center; gap:6px; font-weight:600; font-size:13px; }
.dcd-sub { opacity:.55; font-size:11px; }
.dcd-dot { width:7px; height:7px; border-radius:50%; background:color-mix(in srgb,currentColor 25%,transparent); display:inline-block; }
.dcd-dot.is-live { background:#31b979; box-shadow:0 0 0 0 rgba(49,185,121,.55); animation:dcdPing 2.2s ease-out infinite; }
.dcd-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dcd-row-head { margin-bottom:4px; }
.dcd-num { font-variant-numeric:tabular-nums; font-weight:600; }
.dcd-hint { opacity:.55; font-size:11px; }
.dcd-pressure, .dcd-stats, .dcd-free, .dcd-timeline, .dcd-reminders, .dcd-request { border:1px solid color-mix(in srgb,currentColor 12%,transparent); border-radius:10px; padding:9px 10px; background:color-mix(in srgb,currentColor 3%,transparent); }
.dcd-reminders, .dcd-request { display:flex; flex-direction:column; gap:3px; }
.dcd-kv { display:flex; justify-content:space-between; gap:8px; font-size:11px; font-variant-numeric:tabular-nums; }
.dcd-kv b { font-weight:600; }
.dcd-windowline { margin-top:4px; opacity:.5; font-size:10px; font-variant-numeric:tabular-nums; }
.dcd-stats { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; text-align:center; }
.dcd-stat { display:flex; flex-direction:column; gap:1px; min-width:0; }
.dcd-stat b { font-size:14px; font-variant-numeric:tabular-nums; }
.dcd-stat span { opacity:.55; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dcd-bar { height:6px; border-radius:999px; background:color-mix(in srgb,currentColor 10%,transparent); overflow:hidden; margin-top:6px; }
.dcd-bar-fill { height:100%; border-radius:999px; background:linear-gradient(90deg,#4c8dff,#a06bff); transition:width .5s cubic-bezier(.2,.8,.2,1); }
.dcd-bar-fill--user { background:#4c8dff; }
.dcd-bar-fill--assistant { background:#a06bff; }
.dcd-bar-fill--tool { background:#2fb37e; }
.dcd-bar-fill--other { background:color-mix(in srgb,currentColor 45%,transparent); }
.dcd-bar--block .dcd-bar-fill { background:linear-gradient(90deg,#e0a02a,#e06b4c); }
.dcd-figures { margin-top:4px; opacity:.55; font-size:11px; font-variant-numeric:tabular-nums; }
.dcd-ticker { display:flex; flex-direction:column; gap:3px; }
.dcd-ticker-item { font-size:11px; padding:3px 8px; border-radius:7px; background:color-mix(in srgb,currentColor 6%,transparent); animation:dcdSlide .35s ease-out; }
.dcd-ticker-item.is-fold { border-left:2px solid #e0a02a; }
.dcd-ticker-item.is-drop { border-left:2px solid #e05b5b; }
.dcd-ticker-item.is-append { border-left:2px solid #4c8dff; }
.dcd-timeline { display:flex; flex-direction:column; gap:6px; }
.dcd-timeline-scroll { display:flex; flex-direction:column; gap:6px; max-height:360px; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,currentColor 22%,transparent) transparent; padding-right:2px; }
.dcd-timeline-scroll::-webkit-scrollbar { width:8px; }
.dcd-timeline-scroll::-webkit-scrollbar-track { background:transparent; }
.dcd-timeline-scroll::-webkit-scrollbar-thumb { background:color-mix(in srgb,currentColor 20%,transparent); border-radius:999px; }
.dcd-timeline-scroll::-webkit-scrollbar-thumb:hover { background:color-mix(in srgb,currentColor 34%,transparent); }
.dcd-ghost-more { font-size:10px; opacity:.4; text-align:center; }
.dcd-node { position:relative; display:flex; flex-direction:column; gap:3px; padding:5px 6px; border-radius:8px; background:color-mix(in srgb,currentColor 4%,transparent); }
.dcd-node.is-foldable::before { content:""; position:absolute; left:0; top:5px; bottom:5px; width:2px; border-radius:2px; background:color-mix(in srgb,currentColor 30%,transparent); }
.dcd-node.is-current { outline:1px dashed color-mix(in srgb,#31b979 65%,transparent); outline-offset:1px; }
.dcd-node.is-pulsing { animation:dcdPulse 1.6s ease-out; animation-delay:.18s; }
.dcd-node.is-entering { animation:dcdNodeIn .5s cubic-bezier(.2,.8,.2,1) both; }
.dcd-node.is-ghost { opacity:.35; animation:dcdGhostOut .7s ease-in both; pointer-events:none; }
.dcd-node--block { background:color-mix(in srgb,#e0a02a 9%,transparent); border:1px solid color-mix(in srgb,#e0a02a 30%,transparent); }
.dcd-node-top { display:flex; align-items:center; gap:6px; min-width:0; }
.dcd-anchor { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px; padding:1px 5px; border-radius:5px; background:color-mix(in srgb,currentColor 9%,transparent); white-space:nowrap; }
.dcd-anchor--block { background:color-mix(in srgb,#e0a02a 22%,transparent); }
.dcd-role { font-size:10px; padding:1px 5px; border-radius:5px; background:color-mix(in srgb,currentColor 8%,transparent); }
.dcd-role--user { color:#4c8dff; }
.dcd-role--assistant { color:#a06bff; }
.dcd-role--tool { color:#2fb37e; }
.dcd-tier { font-size:10px; padding:1px 5px; border-radius:5px; background:color-mix(in srgb,#e0a02a 25%,transparent); font-weight:600; }
.dcd-topic { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.7; font-size:11px; }
.dcd-node-meta { margin-left:auto; opacity:.5; font-size:10px; white-space:nowrap; }
.dcd-lock { font-size:10px; color:#31b979; }
.dcd-empty { opacity:.55; margin:0; }
.dcd-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.dcd-chip { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:10px; padding:1px 5px; border-radius:5px; background:color-mix(in srgb,currentColor 8%,transparent); opacity:.75; animation:dcdPop .3s ease-out; }
.dcd-chip-more { opacity:.5; }
.dcd-mech { border:1px solid color-mix(in srgb,currentColor 12%,transparent); border-radius:10px; padding:8px 10px; background:color-mix(in srgb,currentColor 3%,transparent); }
.dcd-mech summary { cursor:pointer; font-weight:600; font-size:12px; }
.dcd-mech-stage { display:flex; align-items:center; gap:6px; margin:10px 0 6px; flex-wrap:wrap; }
.dcd-mech-msgs { display:flex; gap:3px; }
.dcd-mech-msg { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:10px; padding:2px 5px; border-radius:5px; background:color-mix(in srgb,#4c8dff 18%,transparent); animation:dcdMechMsg 4s ease-in-out infinite; }
.dcd-mech-msg:nth-child(2) { animation-delay:.25s; }
.dcd-mech-msg:nth-child(3) { animation-delay:.5s; }
.dcd-mech-arrow { opacity:.4; }
.dcd-mech-sum { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:10px; padding:2px 6px; border-radius:5px; background:color-mix(in srgb,#e0a02a 22%,transparent); border:1px dashed color-mix(in srgb,#e0a02a 55%,transparent); animation:dcdMechSum 4s ease-in-out infinite; }
.dcd-mech-drop { font-size:12px; color:#e05b5b; animation:dcdMechDrop 4s ease-in-out infinite; }
.dcd-mech-free { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:10px; opacity:.7; animation:dcdMechFree 4s ease-in-out infinite; }
.dcd-mech-caption { margin:4px 0 0; opacity:.6; font-size:11px; }
@keyframes dcdPing { 0% { box-shadow:0 0 0 0 rgba(49,185,121,.5); } 70% { box-shadow:0 0 0 6px rgba(49,185,121,0); } 100% { box-shadow:0 0 0 0 rgba(49,185,121,0); } }
@keyframes dcdPulse { 0% { box-shadow:0 0 0 0 rgba(224,160,42,.55); transform:scale(1); } 18% { transform:scale(1.015); } 100% { box-shadow:0 0 0 10px rgba(224,160,42,0); transform:scale(1); } }
@keyframes dcdNodeIn { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:none; } }
@keyframes dcdGhostOut { 0% { opacity:.35; } 55% { opacity:.15; } 100% { opacity:0; transform:scale(.97); } }
@keyframes dcdSlide { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:none; } }
@keyframes dcdPop { from { opacity:0; transform:scale(.85); } to { opacity:.75; transform:none; } }
@keyframes dcdMechMsg { 0%,18% { opacity:1; } 30%,72% { opacity:.25; } 84%,100% { opacity:1; } }
@keyframes dcdMechSum { 0%,24% { opacity:.25; transform:scale(.97); } 38%,84% { opacity:1; transform:scale(1); } 100% { opacity:.25; } }
@keyframes dcdMechDrop { 0%,52% { opacity:.15; } 64%,74% { opacity:1; } 84%,100% { opacity:.15; } }
@keyframes dcdMechFree { 0%,60% { opacity:.15; } 72%,86% { opacity:1; } 100% { opacity:.15; } }
`;
/**
* Map a role to its display key; unknown roles render as "other".
* 中文：把角色映射成展示 key；未知角色按 other 渲染。
*/
function roleKey(role) {
	if (role === "user" || role === "assistant" || role === "tool") return role;
	return "other";
}
/**
* Compact token formatting for the narrow panel.
* 中文：窄面板使用的紧凑 token 格式化。
*/
function formatTokens(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return "—";
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
	return String(value);
}
/**
* Horizontal bar length: sqrt keeps one huge tool result from flattening the rest.
* 中文：水平条长度：用 sqrt 避免一个巨大的 tool result 把其他条压扁。
*/
function barWidth(tokens, maxTokens) {
	return `${Math.round(10 + 88 * Math.sqrt(Math.max(0, tokens) / maxTokens))}%`;
}
/**
* Live node one row of the diagram.
* 中文：图中一行的 live 节点。
*/
function NodeRow({ node, maxTokens, currentTurn, foldableEnd, pulsing, entering = false, enteringDelay = 0, ghost = false, t }) {
	const isCurrent = node.appended === true && node.createdAtTurn === currentTurn;
	const foldable = foldableEnd !== null && node.seq <= foldableEnd;
	const width = barWidth(node.tokens, maxTokens);
	const motion = [
		pulsing && !ghost ? " is-pulsing" : "",
		entering && !ghost ? " is-entering" : "",
		ghost ? " is-ghost" : ""
	].join("");
	const motionStyle = entering || ghost ? { animationDelay: `${Math.min(enteringDelay, 12) * 45}ms` } : void 0;
	if (node.block) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: `dcd-node dcd-node--block${motion}`,
		style: motionStyle,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dcd-node-top",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dcd-anchor dcd-anchor--block",
					title: t("tip.anchor"),
					children: [
						"⟦p",
						node.left,
						"⟧–",
						node.right === null ? "end" : `⟦p${node.right}⟧`
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dcd-tier",
					title: t("tip.tier"),
					children: ["T", node.tier]
				}),
				node.topic !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dcd-topic",
					title: node.topic,
					children: node.topic
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dcd-node-meta",
					title: t("tip.overhead"),
					children: [
						node.summaryChars,
						"c · ",
						formatTokens(node.tokens),
						" tok"
					]
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "dcd-bar dcd-bar--block",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcd-bar-fill",
				style: { width }
			})
		})]
	});
	const key = roleKey(node.role);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: `dcd-node${isCurrent ? " is-current" : ""}${foldable ? " is-foldable" : ""}${motion}`,
		style: motionStyle,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dcd-node-top",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dcd-anchor",
					title: t("tip.anchor"),
					children: [
						"⟦p",
						node.left,
						"⟧"
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: `dcd-role dcd-role--${key}`,
					title: t(`role.${key}`),
					children: t(`role.${key}`)
				}),
				isCurrent && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dcd-lock",
					title: t("tip.protected"),
					children: t("panel.protected")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dcd-node-meta",
					title: t("tip.anchor"),
					children: [formatTokens(node.tokens), " tok"]
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "dcd-bar",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `dcd-bar-fill dcd-bar-fill--${key}`,
				style: { width }
			})
		})]
	});
}
/**
* The animated concept explainer, independent of the live session.
* 中文：动画机制讲解，独立于 live session。
*/
function Mechanism({ t }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
		className: "dcd-mech",
		open: true,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("panel.mechanism") }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcd-mech-stage",
				"aria-hidden": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-mech-msgs",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcd-mech-msg",
								children: "⟦p0⟧"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcd-mech-msg",
								children: "⟦p1⟧"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcd-mech-msg",
								children: "⟦p2⟧"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-mech-arrow",
						children: "→"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-mech-sum",
						children: "⟦p0⟧…⟦p2⟧ T1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-mech-arrow",
						children: "→"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-mech-drop",
						children: "✕"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-mech-arrow",
						children: "→"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-mech-free",
						children: "⟦p3⟧ ⟦p0⟧ ⟦p1⟧ ⟦p2⟧"
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dcd-mech-caption",
				children: t("panel.mechanismCaption")
			})
		]
	});
}
/**
* The tab body. `useProjection` and `t` are framework session-standard props.
* 中文：标签页主体。`useProjection` 和 `t` 是框架 session 的标准 props。
*/
function ContextDecayPanel({ useProjection, t }) {
	const decay = useProjection("contextDecay");
	const [ticker, setTicker] = (0, react.useState)([]);
	const [pulseSeq, setPulseSeq] = (0, react.useState)(null);
	const [ghosts, setGhosts] = (0, react.useState)([]);
	const [recent, setRecent] = (0, react.useState)([]);
	const previous = (0, react.useRef)(void 0);
	const counter = (0, react.useRef)(0);
	const ghostTimer = (0, react.useRef)(null);
	const recentTimer = (0, react.useRef)(null);
	const nodes = decay?.nodes ?? [];
	const displayNodes = (0, react.useMemo)(() => [...nodes].reverse(), [nodes]);
	const maxTokens = (0, react.useMemo)(() => Math.max(1, ...nodes.length > 0 ? nodes.map((node) => node.tokens) : [1]), [nodes]);
	const ghostNodes = ghosts.slice(0, GHOST_NODE_LIMIT);
	const extraGhostCount = ghosts.length - ghostNodes.length;
	(0, react.useEffect)(() => {
		if (decay === void 0) return;
		const before = previous.current;
		previous.current = decay;
		if (before === void 0) return;
		const beforeBySeq = new Map(before.nodes.map((node) => [node.seq, node]));
		const afterBySeq = new Map(decay.nodes.map((node) => [node.seq, node]));
		const added = [...afterBySeq.values()].filter((node) => !beforeBySeq.has(node.seq));
		const removed = [...beforeBySeq.values()].filter((node) => !afterBySeq.has(node.seq));
		if (removed.length > 0) {
			setGhosts(removed);
			if (ghostTimer.current !== null) clearTimeout(ghostTimer.current);
			ghostTimer.current = setTimeout(() => setGhosts([]), 780);
		}
		if (added.length > 0) {
			setRecent(added.map((node) => node.seq));
			if (recentTimer.current !== null) clearTimeout(recentTimer.current);
			recentTimer.current = setTimeout(() => setRecent([]), 980);
		}
		const events = [];
		for (const [seq, node] of afterBySeq) {
			if (beforeBySeq.has(seq)) continue;
			if (node.block) {
				events.push({
					kind: "fold",
					pair: `[⟦p${node.left}⟧, ${node.right === null ? "end" : `⟦p${node.right}⟧`})`,
					tier: node.tier,
					seq
				});
				setPulseSeq(seq);
			} else events.push({
				kind: "append",
				id: node.left,
				seq
			});
		}
		for (const [seq, node] of beforeBySeq) {
			if (afterBySeq.has(seq)) continue;
			if (node.block) events.push({
				kind: "drop",
				pair: `[⟦p${node.left}⟧, ${node.right === null ? "end" : `⟦p${node.right}⟧`})`,
				seq
			});
		}
		if (events.length === 0) return;
		counter.current += 1;
		const tag = counter.current;
		setTicker((current) => [...events.map((event, index) => ({
			...event,
			key: `${tag}-${index}-${event.seq}`
		})), ...current].slice(0, 6));
	}, [decay]);
	(0, react.useEffect)(() => {
		if (pulseSeq === null) return void 0;
		const timer = setTimeout(() => setPulseSeq(null), 1700);
		return () => clearTimeout(timer);
	}, [pulseSeq]);
	(0, react.useEffect)(() => () => {
		if (ghostTimer.current !== null) clearTimeout(ghostTimer.current);
		if (recentTimer.current !== null) clearTimeout(recentTimer.current);
	}, []);
	const pressure = decay?.pressure ?? null;
	const reminder = decay?.reminder ?? null;
	const request = decay?.request ?? null;
	const used = pressure?.tokens;
	const cap = pressure?.window;
	const percent = pressure === null ? null : Math.max(0, Math.min(100, Math.round(pressure.ratio * 100)));
	const totalPercent = pressure === null ? null : Math.max(0, Math.min(100, Math.round(pressure.tokens / pressure.totalWindow * 100)));
	const sourceLabel = pressure === null ? "" : {
		meter: t("source.meter"),
		usage: t("source.usage"),
		estimate: t("source.estimate")
	}[pressure.source] ?? pressure.source;
	const free = decay?.free ?? [];
	const blocks = nodes.filter((node) => node.block).length;
	const currentTurn = decay?.openTurn ?? null;
	const foldableEndSeq = decay?.compressibleEndSeq ?? null;
	const foldableEndPosition = decay?.compressibleEndPosition ?? null;
	const recentIndex = new Map(recent.map((seq, index) => [seq, index]));
	const stat = (value, label, tip) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dcd-stat",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: value === void 0 || value === null ? "—" : value }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			title: tip,
			children: label
		})]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dcd-root",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: "dcd-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-title",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dcd-dot${decay === void 0 ? "" : " is-live"}` }),
						t("panel.title"),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcd-hint",
							children: decay === void 0 ? t("panel.offline") : t("panel.live")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcd-sub",
					children: t("panel.subtitle")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcd-pressure",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							title: t("tip.pressure"),
							children: t("panel.pressure")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcd-num",
							title: t("tip.pressure"),
							children: percent === null ? "—" : `${percent}%`
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dcd-bar",
						title: t("tip.pressure"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dcd-bar-fill",
							style: { width: `${percent ?? 0}%` }
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dcd-figures",
						title: t("tip.pressure"),
						children: pressure === null ? t("panel.waiting") : `${formatTokens(used)} / ${formatTokens(cap)} tok · ${sourceLabel}`
					}),
					pressure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dcd-windowline",
						title: t("tip.window"),
						children: t("panel.windowLine", {
							total: formatTokens(pressure.totalWindow),
							reserve: formatTokens(pressure.reservedOutput),
							effective: formatTokens(pressure.window)
						})
					}),
					pressure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dcd-windowline",
						title: t("tip.occupancyLine"),
						children: t("panel.occupancyLine", {
							percent: totalPercent,
							used: formatTokens(pressure.tokens),
							total: formatTokens(pressure.totalWindow)
						})
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcd-reminders",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: t("tip.reminders"),
						children: t("panel.reminders")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-hint",
						title: t("tip.thresholds"),
						children: pressure === null ? "" : `${t("panel.thresholds")} ${pressure.warnRatios.map((ratio) => Math.round(ratio * 100)).join("/")}%`
					})]
				}), reminder === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcd-figures",
					children: t("panel.waiting")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.level"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.level") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [
							reminder.lastLevel,
							"/",
							pressure?.warnRatios.length ?? "?"
						] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.lastReminder"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.lastReminder") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"#",
							reminder.lastTurn ?? "—",
							" · ",
							formatTokens(reminder.lastTokens),
							" tok"
						] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.growth"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.growth") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [formatTokens(reminder.growth), " tok"] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.nextGrowth"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.nextGrowth") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [formatTokens(reminder.nextGrowthAt), " tok"] })]
					})
				] })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcd-request",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: t("tip.request"),
						children: t("panel.lastRequest")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-hint",
						title: request === null ? t("tip.request") : `${t("tip.request")} · process #${request.processIndex}`,
						children: request === null ? "" : `#${request.sessionIndex}`
					})]
				}), request === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcd-figures",
					children: t("panel.waiting")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.messages"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.messages") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: request.messages })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.anchors"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.anchors") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: request.anchors })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.blocks"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.blocks") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: request.blocks })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcd-kv",
						title: t("tip.overhead"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.overhead") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [request.overheadTokens, " tok"] })]
					})
				] })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcd-stats",
				children: [
					stat(decay?.nextPosition, t("stat.allocated"), t("tip.allocated")),
					stat(decay === void 0 ? void 0 : free.length, t("stat.free"), t("tip.free")),
					stat(decay?.reusedPositions, t("stat.reused"), t("tip.reused")),
					stat(decay === void 0 ? void 0 : nodes.length, t("stat.visible"), t("tip.visible")),
					stat(decay === void 0 ? void 0 : blocks, t("stat.blocks"), t("tip.statsBlocks"))
				]
			}),
			ticker.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcd-ticker",
				title: t("tip.ticker"),
				children: ticker.map((event, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `dcd-ticker-item dcd-ticker-item--${event.kind}`,
					style: { animationDelay: `${index * 40}ms` },
					children: [
						event.kind === "fold" && t("panel.fold", {
							pair: event.pair,
							tier: event.tier
						}),
						event.kind === "drop" && t("panel.drop", { pair: event.pair }),
						event.kind === "append" && t("panel.append", { id: event.id })
					]
				}, event.key))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcd-timeline",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-row dcd-row-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: t("tip.timeline"),
						children: t("panel.timeline")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcd-hint",
						title: t("tip.foldable"),
						children: [currentTurn === null ? "" : t("panel.turn", { turn: currentTurn }), foldableEndPosition === null ? "" : ` · ${t("panel.foldable", { end: foldableEndPosition })}`]
					})]
				}), decay === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dcd-empty",
					children: t("panel.waiting")
				}) : nodes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dcd-empty",
					children: t("panel.empty")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-timeline-scroll",
					children: [
						displayNodes.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeRow, {
							node,
							maxTokens,
							currentTurn,
							foldableEnd: foldableEndSeq,
							t,
							pulsing: pulseSeq === node.seq,
							entering: recentIndex.has(node.seq),
							enteringDelay: recentIndex.get(node.seq) ?? 0
						}, node.seq)),
						ghostNodes.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeRow, {
							node,
							maxTokens,
							currentTurn,
							foldableEnd: foldableEndSeq,
							t,
							ghost: true
						}, `ghost-${node.seq}`)),
						extraGhostCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dcd-ghost-more",
							children: ["+", extraGhostCount]
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcd-free",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: t("tip.freeIds"),
						children: t("panel.freeIds")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcd-hint",
						children: free.length
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcd-chips",
					children: [free.slice(0, 16).map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcd-chip",
						children: [
							"⟦p",
							id,
							"⟧"
						]
					}, id)), free.length > 16 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcd-chip dcd-chip-more",
						children: ["+", free.length - 16]
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Mechanism, { t })
		]
	});
}
/**
* Client plugin body: register the tab type, its guide entry, the body, and styles.
* 中文：客户端插件主体：注册标签类型、引导入口、标签主体和样式。
*/
const inject = [
	"slots",
	"locale",
	"sidebarRightTabs"
];
function apply(ctx) {
	const t = ctx.locale.bind(NS);
	ctx.effect(() => ctx.locale.register(NS, {
		en,
		zh
	}), "context-decay: locale");
	ctx.effect(() => ctx.sidebarRightTabs.register({
		id: ID,
		kind: KIND,
		priority: "extension",
		title: () => t("type.title"),
		guide: [{
			id: "context-decay",
			order: 30,
			title: () => t("guide.title"),
			description: () => t("guide.description")
		}]
	}), "context-decay: tab type");
	ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
		name: "sidebar.right.pane.tab",
		key: ID,
		locale: NS
	}, ContextDecayPanel)), "context-decay: tab body");
	ctx.effect(() => {
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-context-decay";
		tag.dataset.pluginCss = "dsh-context-decay/panel.css";
		tag.textContent = STYLE;
		document.head.appendChild(tag);
		return () => {
			tag.remove();
		};
	}, "context-decay: panel styles");
}
//#endregion
exports.ContextDecayPanel = ContextDecayPanel;
exports.apply = apply;
exports.inject = inject;


return module.exports;
} });
