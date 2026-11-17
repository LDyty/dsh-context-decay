/**
 * Browser half of dsh-context-decay: a right-Sidebar tab that draws the live
 * anchor space as an animated diagram.
 *
 * Data arrives through the host `contextDecay` session projection (a pure
 * replay fold, with the host runtime pressure/reminder/request snapshot merged
 * into every view). This bundle has no runtime dependency beyond React from the
 * shell module table.
 *
 * 中文：dsh-context-decay 的浏览器端：右侧栏标签页，用动画图画出 live 锚点空间。
 * 数据来自宿主 `contextDecay` session projection（纯重放 fold，宿主运行时的压力/提醒/请求
 * 快照会合并进每个视图）。除 shell 模块表提供的 React 外，本 bundle 没有运行时依赖。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Package row id (must equal package.json name) and this tab type's identity.
 * 中文：包行 id（必须等于 package.json 的 name）以及本标签类型身份。
 */
const ID = 'dsh-context-decay/panel'
const KIND = 'context-decay'
const NS = 'contextDecay'

/**
 * Ghost rows are transient removal animations; cap them so one large fold
 * cannot briefly stretch the scroll area.
 * 中文：ghost 行是短暂的移除动画；限制数量，避免一次大折叠短暂撑高滚动区。
 */
const GHOST_NODE_LIMIT = 6

/**
 * User-facing copy is Chinese. The same dictionary is registered for both
 * locale keys so an English shell still shows the Chinese product name.
 * 中文：用户界面文案全部中文。同一份字典同时注册到 en/zh，英文 shell 也显示中文产品名。
 */
const copy = {
  'type.title': '上下文自觉压缩',
  'guide.title': '上下文自觉压缩',
  'guide.description': '锚点池、摘要块、回收复用与有效窗口压力的实时图解',
  'panel.title': '上下文自觉压缩',
  'panel.subtitle': '自觉压缩 · 实时锚点图谱',
  'panel.pressure': '有效窗口压力',
  'panel.waiting': '等待会话快照…',
  'panel.empty': '还没有可见消息。',
  'panel.allocated': '已分配',
  'panel.free': '回收可用',
  'panel.reused': '复用次数',
  'panel.visible': '可见节点',
  'panel.blocks': '摘要块',
  'panel.pool': '锚点池',
  'panel.windowLine': '总窗口 {total} − 输出预留 {reserve} = 有效窗口 {effective}',
  'panel.occupancyLine': '总窗口占用 {percent}% · {used} / {total}',
  'panel.reminders': '提醒',
  'panel.interval': '每 2.5% 有效窗口',
  'panel.lastReminder': '上次提醒',
  'panel.baseline': '基线',
  'panel.growth': '距上次增长',
  'panel.nextGrowth': '下次提醒',
  'panel.lastRequest': '本会话最近请求',
  'panel.messages': '消息',
  'panel.anchors': '锚点',
  'panel.overhead': '锚点开销',
  'source.meter': 'meter',
  'source.usage': 'provider usage',
  'source.estimate': '本地估算',
  'stat.allocated': '已分配',
  'stat.free': '回收可用',
  'stat.reused': '复用次数',
  'stat.visible': '可见节点',
  'stat.blocks': '摘要块',
  'stat.pool': '锚点池',
  'panel.timeline': '锚点空间',
  'panel.turn': '第 {turn} 回合',
  'panel.protected': '受保护',
  'panel.foldable': '可压缩至 {anchor}',
  'panel.freeIds': '回收锚点',
  'panel.summary': '摘要块',
  'panel.fold': '压缩 {pair} → 层级 {tier}',
  'panel.append': '分配 {anchor}',
  'panel.mechanism': '机制图解',
  'panel.mechanismCaption': '被压缩区间内部的锚点回到锚点池；后续消息优先复用。摘要块保留左右边界作为自身句柄，因此边界锚点继续可见。',
  'panel.live': '实时',
  'panel.offline': '无投影',
  'role.user': '用户',
  'role.assistant': '助手',
  'role.tool': '工具',
  'role.other': '其他',
  'tip.pressure': '下一次请求占有效窗口（总窗口 − 输出预留）的比例；与提醒使用同一读数。',
  'tip.window': '有效窗口 = 总窗口 − 输出预留（来自 request/header.config.maxTokens）。',
  'tip.occupancyLine': '与内置上下文进度使用同一个总窗口分母；上面的有效窗口压力用于提醒。',
  'tip.reminders': '每用掉有效窗口的 2.5%，注入一条极简提醒，只报告已用 token/有效窗口和百分比。',
  'tip.interval': '提醒间隔固定为有效窗口的 2.5%；首次观察只建立静默基线，压缩后重新建立基线。',
  'tip.lastReminder': '最近一次提醒所在回合与当时的 token 数；尚未触发提醒时显示静默基线。',
  'tip.baseline': '首次观察或压缩后的静默基线；达到 2.5% 增长后才会注入提醒。',
  'tip.growth': '距上次提醒增长了多少 token；达到 2.5% 步长后触发下一次提醒。',
  'tip.nextGrowth': '下一次周期提醒的绝对 token 触发点。',
  'tip.request': '本会话第 N 次被装饰的模型请求；跨进程重启保持连续。',
  'tip.messages': '该次请求中的消息数。',
  'tip.anchors': '该次请求中的内联锚点数。',
  'tip.blocks': '该次请求时的活动摘要块数。',
  'tip.overhead': '该次请求锚点装饰估算增加的 token。',
  'tip.allocated': '本会话已分配锚点次数；复用回收锚点也计数。',
  'tip.free': '被压缩释放、可供后续消息复用的锚点。',
  'tip.reused': '分配时取用回收锚点、而非新锚点的次数。',
  'tip.visible': '当前带锚点的模型可见节点数。',
  'tip.statsBlocks': '当前 surface 上的活动摘要块数。',
  'tip.pool': '已经预生成、尚未发放的锚点数量；低于低水位时会自动扩池。',
  'tip.timeline': '实时锚点按上下文顺序排列：最新的消息在最上面，向下滚动查看更早的消息。锚点是句柄，不代表顺序。',
  'tip.freeIds': '被压缩释放的锚点；后续消息优先复用。',
  'tip.anchor': '锚点句柄是身份，不是顺序：较新的消息可能复用较早出现过的锚点。',
  'tip.tier': '压缩层级：对同一 pair 再压缩一次会增加一层。',
  'tip.ticker': '最近的压缩与锚点分配事件。',
  'tip.protected': '当前回合保持完整；压缩 span 在它之前结束。',
  'tip.foldable': '本次请求中最后一个可压缩的锚点。',
}

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
.dcd-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; text-align:center; }
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
@keyframes dcdMechFree { 0%,60% { opacity:.15; } 72%,86% { opacity:1; } 100% { opacity:.15; } }
`

/**
 * Map a role to its display key; unknown roles render as "other".
 * 中文：把角色映射成展示 key；未知角色按 other 渲染。
 */
function roleKey(role) {
  if (role === 'user' || role === 'assistant' || role === 'tool') return role
  return 'other'
}

/**
 * Compact token formatting for the narrow panel.
 * 中文：窄面板使用的紧凑 token 格式化。
 */
function formatTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

/**
 * Model-visible anchor text for the panel.
 * 中文：面板显示的模型可见锚点文本。
 */
function anchorText(anchor) {
  return `⟦#${anchor}⟧`
}

/**
 * Horizontal bar length: sqrt keeps one huge tool result from flattening the rest.
 * 中文：水平条长度：用 sqrt 避免一个巨大的 tool result 把其他条压扁。
 */
function barWidth(tokens, maxTokens) {
  return `${Math.round(10 + 88 * Math.sqrt(Math.max(0, tokens) / maxTokens))}%`
}

/**
 * Live node one row of the diagram.
 * 中文：图中一行的 live 节点。
 */
function NodeRow({ node, maxTokens, currentTurn, foldableEnd, pulsing, entering = false, enteringDelay = 0, ghost = false, t }) {
  const isCurrent = node.appended === true && node.createdAtTurn === currentTurn
  const foldable = foldableEnd !== null && node.seq <= foldableEnd
  const width = barWidth(node.tokens, maxTokens)
  const motion = [
    pulsing && !ghost ? ' is-pulsing' : '',
    entering && !ghost ? ' is-entering' : '',
    ghost ? ' is-ghost' : '',
  ].join('')
  const motionStyle = entering || ghost ? { animationDelay: `${Math.min(enteringDelay, 12) * 45}ms` } : undefined
  if (node.block) {
    return (
      <div className={`dcd-node dcd-node--block${motion}`} style={motionStyle}>
        <div className="dcd-node-top">
          <span className="dcd-anchor dcd-anchor--block" title={t('tip.anchor')}>
            {anchorText(node.left)}–{node.right === null ? 'end' : anchorText(node.right)}
          </span>
          <span className="dcd-tier" title={t('tip.tier')}>T{node.tier}</span>
          {node.topic !== null && <span className="dcd-topic" title={node.topic}>{node.topic}</span>}
          <span className="dcd-node-meta" title={t('tip.overhead')}>
            {node.summaryChars}c · {formatTokens(node.tokens)} tok
          </span>
        </div>
        <div className="dcd-bar dcd-bar--block"><div className="dcd-bar-fill" style={{ width }} /></div>
      </div>
    )
  }
  const key = roleKey(node.role)
  return (
    <div className={`dcd-node${isCurrent ? ' is-current' : ''}${foldable ? ' is-foldable' : ''}${motion}`} style={motionStyle}>
      <div className="dcd-node-top">
        <span className="dcd-anchor" title={t('tip.anchor')}>{anchorText(node.left)}</span>
        <span className={`dcd-role dcd-role--${key}`} title={t(`role.${key}`)}>{t(`role.${key}`)}</span>
        {isCurrent && <span className="dcd-lock" title={t('tip.protected')}>{t('panel.protected')}</span>}
        <span className="dcd-node-meta" title={t('tip.anchor')}>{formatTokens(node.tokens)} tok</span>
      </div>
      <div className="dcd-bar"><div className={`dcd-bar-fill dcd-bar-fill--${key}`} style={{ width }} /></div>
    </div>
  )
}

/**
 * The animated concept explainer, independent of the live session.
 * 中文：动画机制讲解，独立于 live session。
 */
function Mechanism({ t }) {
  return (
    <details className="dcd-mech" open>
      <summary>{t('panel.mechanism')}</summary>
      <div className="dcd-mech-stage" aria-hidden>
        <div className="dcd-mech-msgs">
          <span className="dcd-mech-msg">{anchorText('a8c5')}</span>
          <span className="dcd-mech-msg">{anchorText('c9d1')}</span>
          <span className="dcd-mech-msg">{anchorText('e2f3')}</span>
        </div>
        <span className="dcd-mech-arrow">→</span>
        <span className="dcd-mech-sum">{anchorText('a8c5')}…{anchorText('e2f3')} T1</span>
        <span className="dcd-mech-arrow">→</span>
        <span className="dcd-mech-free">{anchorText('c9d1')} 回收</span>
      </div>
      <p className="dcd-mech-caption">{t('panel.mechanismCaption')}</p>
    </details>
  )
}

/**
 * The tab body. `useProjection` and `t` are framework session-standard props.
 * 中文：标签页主体。`useProjection` 和 `t` 是框架 session 的标准 props。
 */
export function ContextDecayPanel({ useProjection, t }) {
  const decay = useProjection('contextDecay')
  const [ticker, setTicker] = useState([])
  const [pulseSeq, setPulseSeq] = useState(null)
  const [ghosts, setGhosts] = useState([])
  const [recent, setRecent] = useState([])
  const previous = useRef(undefined)
  const counter = useRef(0)
  const ghostTimer = useRef(null)
  const recentTimer = useRef(null)

  const nodes = decay?.nodes ?? []
  const displayNodes = useMemo(() => [...nodes].reverse(), [nodes])
  const maxTokens = useMemo(
    () => Math.max(1, ...(nodes.length > 0 ? nodes.map(node => node.tokens) : [1])),
    [nodes],
  )
  const ghostNodes = ghosts.slice(0, GHOST_NODE_LIMIT)
  const extraGhostCount = ghosts.length - ghostNodes.length

  useEffect(() => {
    if (decay === undefined) return
    const before = previous.current
    previous.current = decay
    if (before === undefined) return
    const beforeBySeq = new Map(before.nodes.map(node => [node.seq, node]))
    const afterBySeq = new Map(decay.nodes.map(node => [node.seq, node]))
    const added = [...afterBySeq.values()].filter(node => !beforeBySeq.has(node.seq))
    const removed = [...beforeBySeq.values()].filter(node => !afterBySeq.has(node.seq))
    if (removed.length > 0) {
      setGhosts(removed)
      if (ghostTimer.current !== null) clearTimeout(ghostTimer.current)
      ghostTimer.current = setTimeout(() => setGhosts([]), 780)
    }
    if (added.length > 0) {
      setRecent(added.map(node => node.seq))
      if (recentTimer.current !== null) clearTimeout(recentTimer.current)
      recentTimer.current = setTimeout(() => setRecent([]), 980)
    }
    const events = []
    for (const [seq, node] of afterBySeq) {
      if (beforeBySeq.has(seq)) continue
      if (node.block) {
        events.push({
          kind: 'fold',
          pair: `[${anchorText(node.left)}, ${node.right === null ? 'end' : anchorText(node.right)})`,
          tier: node.tier,
          seq,
        })
        setPulseSeq(seq)
      } else {
        events.push({ kind: 'append', anchor: anchorText(node.left), seq })
      }
    }
    if (events.length === 0) return
    counter.current += 1
    const tag = counter.current
    setTicker(current => [...events.map((event, index) => ({ ...event, key: `${tag}-${index}-${event.seq}` })), ...current].slice(0, 6))
  }, [decay])

  useEffect(() => {
    if (pulseSeq === null) return undefined
    const timer = setTimeout(() => setPulseSeq(null), 1700)
    return () => clearTimeout(timer)
  }, [pulseSeq])

  useEffect(() => () => {
    if (ghostTimer.current !== null) clearTimeout(ghostTimer.current)
    if (recentTimer.current !== null) clearTimeout(recentTimer.current)
  }, [])

  const pressure = decay?.pressure ?? null
  const reminder = decay?.reminder ?? null
  const request = decay?.request ?? null
  const used = pressure?.tokens
  const cap = pressure?.window
  const percent = pressure === null ? null : Math.max(0, Math.min(100, Math.round(pressure.ratio * 100)))
  const totalPercent = pressure === null
    ? null
    : Math.max(0, Math.min(100, Math.round(pressure.tokens / pressure.totalWindow * 100)))
  const sourceLabel = pressure === null
    ? ''
    : ({ meter: t('source.meter'), usage: t('source.usage'), estimate: t('source.estimate') })[pressure.source]
      ?? pressure.source
  const free = decay?.free ?? []
  const blocks = nodes.filter(node => node.block).length
  const currentTurn = decay?.openTurn ?? null
  const foldableEndSeq = decay?.compressibleEndSeq ?? null
  const foldableEndAnchor = decay?.compressibleEndPosition ?? null
  const recentIndex = new Map(recent.map((seq, index) => [seq, index]))

  const stat = (value, label, tip) => (
    <div className="dcd-stat">
      <b>{value === undefined || value === null ? '—' : value}</b>
      <span title={tip}>{label}</span>
    </div>
  )

  return (
    <div className="dcd-root">
      <header className="dcd-head">
        <div className="dcd-title">
          <span className={`dcd-dot${decay === undefined ? '' : ' is-live'}`} />
          {t('panel.title')}
          <span className="dcd-hint">{decay === undefined ? t('panel.offline') : t('panel.live')}</span>
        </div>
        <div className="dcd-sub">{t('panel.subtitle')}</div>
      </header>

      <section className="dcd-pressure">
        <div className="dcd-row">
          <span title={t('tip.pressure')}>{t('panel.pressure')}</span>
          <span className="dcd-num" title={t('tip.pressure')}>{percent === null ? '—' : `${percent}%`}</span>
        </div>
        <div className="dcd-bar" title={t('tip.pressure')}>
          <div className="dcd-bar-fill" style={{ width: `${percent ?? 0}%` }} />
        </div>
        <div className="dcd-figures" title={t('tip.pressure')}>
          {pressure === null
            ? t('panel.waiting')
            : `${formatTokens(used)} / ${formatTokens(cap)} tok · ${sourceLabel}`}
        </div>
        {pressure !== null && (
          <div className="dcd-windowline" title={t('tip.window')}>
            {t('panel.windowLine', {
              total: formatTokens(pressure.totalWindow),
              reserve: formatTokens(pressure.reservedOutput),
              effective: formatTokens(pressure.window),
            })}
          </div>
        )}
        {pressure !== null && (
          <div className="dcd-windowline" title={t('tip.occupancyLine')}>
            {t('panel.occupancyLine', {
              percent: totalPercent,
              used: formatTokens(pressure.tokens),
              total: formatTokens(pressure.totalWindow),
            })}
          </div>
        )}
      </section>

      <section className="dcd-reminders">
        <div className="dcd-row">
          <span title={t('tip.reminders')}>{t('panel.reminders')}</span>
          <span className="dcd-hint" title={t('tip.interval')}>{t('panel.interval')}</span>
        </div>
        {reminder === null ? <div className="dcd-figures">{t('panel.waiting')}</div> : (
          <>
            <div className="dcd-kv" title={reminder.lastTurn === null ? t('tip.baseline') : t('tip.lastReminder')}>
              <span>{reminder.lastTurn === null ? t('panel.baseline') : t('panel.lastReminder')}</span>
              <span>
                {reminder.lastTurn === null ? '' : `#${reminder.lastTurn} · `}
                {formatTokens(reminder.lastTokens)} tok
              </span>
            </div>
            <div className="dcd-kv" title={t('tip.growth')}>
              <span>{t('panel.growth')}</span>
              <span>{formatTokens(reminder.growth)} tok</span>
            </div>
            <div className="dcd-kv" title={t('tip.nextGrowth')}>
              <span>{t('panel.nextGrowth')}</span>
              <span>{formatTokens(reminder.nextGrowthAt)} tok</span>
            </div>
          </>
        )}
      </section>

      <section className="dcd-request">
        <div className="dcd-row">
          <span title={t('tip.request')}>{t('panel.lastRequest')}</span>
          <span
            className="dcd-hint"
            title={request === null ? t('tip.request') : `${t('tip.request')} · process #${request.processIndex}`}
          >
            {request === null ? '' : `#${request.sessionIndex}`}
          </span>
        </div>
        {request === null ? <div className="dcd-figures">{t('panel.waiting')}</div> : (
          <>
            <div className="dcd-kv" title={t('tip.messages')}>
              <span>{t('panel.messages')}</span>
              <span>{request.messages}</span>
            </div>
            <div className="dcd-kv" title={t('tip.anchors')}>
              <span>{t('panel.anchors')}</span>
              <span>{request.anchors}</span>
            </div>
            <div className="dcd-kv" title={t('tip.blocks')}>
              <span>{t('panel.blocks')}</span>
              <span>{request.blocks}</span>
            </div>
            <div className="dcd-kv" title={t('tip.overhead')}>
              <span>{t('panel.overhead')}</span>
              <span>{request.overheadTokens} tok</span>
            </div>
          </>
        )}
      </section>

      <section className="dcd-stats">
        {stat(decay?.allocated, t('stat.allocated'), t('tip.allocated'))}
        {stat(decay === undefined ? undefined : free.length, t('stat.free'), t('tip.free'))}
        {stat(decay?.reusedPositions, t('stat.reused'), t('tip.reused'))}
        {stat(decay === undefined ? undefined : nodes.length, t('stat.visible'), t('tip.visible'))}
        {stat(decay === undefined ? undefined : blocks, t('stat.blocks'), t('tip.statsBlocks'))}
        {stat(decay?.anchorPool, t('stat.pool'), t('tip.pool'))}
      </section>

      {ticker.length > 0 && (
        <div className="dcd-ticker" title={t('tip.ticker')}>
          {ticker.map((event, index) => (
            <div
              key={event.key}
              className={`dcd-ticker-item dcd-ticker-item--${event.kind}`}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              {event.kind === 'fold' && t('panel.fold', { pair: event.pair, tier: event.tier })}
              {event.kind === 'append' && t('panel.append', { anchor: event.anchor })}
            </div>
          ))}
        </div>
      )}

      <section className="dcd-timeline">
        <div className="dcd-row dcd-row-head">
          <span title={t('tip.timeline')}>{t('panel.timeline')}</span>
          <span className="dcd-hint" title={t('tip.foldable')}>
            {currentTurn === null ? '' : t('panel.turn', { turn: currentTurn })}
            {foldableEndAnchor === null ? '' : ` · ${t('panel.foldable', { anchor: anchorText(foldableEndAnchor) })}`}
          </span>
        </div>
        {decay === undefined
          ? <p className="dcd-empty">{t('panel.waiting')}</p>
          : nodes.length === 0
            ? <p className="dcd-empty">{t('panel.empty')}</p>
            : (
              <div className="dcd-timeline-scroll">
                {displayNodes.map(node => (
                  <NodeRow
                    key={node.seq}
                    node={node}
                    maxTokens={maxTokens}
                    currentTurn={currentTurn}
                    foldableEnd={foldableEndSeq}
                    t={t}
                    pulsing={pulseSeq === node.seq}
                    entering={recentIndex.has(node.seq)}
                    enteringDelay={recentIndex.get(node.seq) ?? 0}
                  />
                ))}
                {ghostNodes.map(node => (
                  <NodeRow
                    key={`ghost-${node.seq}`}
                    node={node}
                    maxTokens={maxTokens}
                    currentTurn={currentTurn}
                    foldableEnd={foldableEndSeq}
                    t={t}
                    ghost
                  />
                ))}
                {extraGhostCount > 0 && <div className="dcd-ghost-more">+{extraGhostCount}</div>}
              </div>
            )}
      </section>

      <section className="dcd-free">
        <div className="dcd-row">
          <span title={t('tip.freeIds')}>{t('panel.freeIds')}</span>
          <span className="dcd-hint">{free.length}</span>
        </div>
        <div className="dcd-chips">
          {free.slice(0, 16).map(anchor => <span key={anchor} className="dcd-chip">{anchorText(anchor)}</span>)}
          {free.length > 16 && <span className="dcd-chip dcd-chip-more">+{free.length - 16}</span>}
        </div>
      </section>

      <Mechanism t={t} />
    </div>
  )
}

/**
 * Client plugin body: register the tab type, its guide entry, the body, and styles.
 * 中文：客户端插件主体：注册标签类型、引导入口、标签主体和样式。
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { en: copy, zh: copy }), 'context-decay: locale')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    priority: 'extension',
    title: () => t('type.title'),
    guide: [{
      id: 'context-decay',
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'context-decay: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
    locale: NS,
  }, ContextDecayPanel)), 'context-decay: tab body')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-context-decay'
    tag.dataset.pluginCss = 'dsh-context-decay/panel.css'
    tag.textContent = STYLE
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'context-decay: panel styles')
}
