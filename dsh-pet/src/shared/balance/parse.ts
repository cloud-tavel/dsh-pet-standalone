// 解析：host 写进 /state 叶子的原始响应 → 客户端视图。
//
// 这一层是**白名单透传**：字段一个一个挑，没写进来的字段会被静默丢弃（新增字段必须在这里加）。
// 形状不认识 / 非法 → 返回 null，让调用方跳过这一拍；这里绝不抛异常（跑在 1s 轮询里，
// 抛一次会把整拍打断，其余叶子也跟着不渲染）。

import type { BalanceState, CustomNode, CustomTag, MoneyWalletView, RawBalanceResult } from './types';

// ---- 自定义气泡（shape:'custom'）的节点树白名单 ----
//
// 第三方交来的树是**外部输入**，解析层负责把它裁进"一个气泡能画出来"的范围；渲染器只画不再校验。

/** 合法 tag：只开放排布局需要的几个。`script/style/iframe/svg` 之类一律不认（非法 tag = 整树作废）。 */
export const CUSTOM_TAGS: readonly CustomTag[] = ['div', 'span', 'i', 'b', 'strong', 'em', 'img'];

/**
 * 合法内联样式（camelCase，与 React style 对象同形）—— 覆盖 flex 布局、盒模型、文字、圆角背景。
 *
 * **刻意不含** `position` / `zIndex` / `transform` / `inset`：气泡是悬在宠物头顶的浮层，那几样
 * 能让内容跑出气泡、盖住宠物本体或宿主页面（与"气泡默认不挡页面"的既有约束冲突）。
 */
export const CUSTOM_STYLE_KEYS: ReadonlySet<string> = new Set([
  'display',
  'flex',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'gap',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'color',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'whiteSpace',
  'verticalAlign',
  'fontVariantNumeric',
  'background',
  'backgroundColor',
  'border',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'borderRadius',
  'overflow',
  'opacity',
]);

/** 样式值里一律禁止的片段：外部资源、表达式、注释截断。要图请用 `img` 节点（地址另有限制）。 */
const BANNED_STYLE_VALUE = /url\(|expression|javascript:|vbscript:|@import|\\|\/\*/i;

/**
 * 容量上限：气泡宽度只有 10.989em（约 155px），且它悬在宠物头顶。
 * 超限的处理分两种：**文本截断**（truncate，内容还能看）与**整树作废**（结构超限，
 * 因为少画一块会得到一棵骗人的树——不如这一拍不显示）。
 */
export const CUSTOM_LIMITS = {
  /** 树深上限（根为 0）；超出 = 整树作废 */
  maxDepth: 6,
  /** 全树节点数上限；超出 = 整树作废 */
  maxNodes: 200,
  /** 单节点子节点数上限；超出 = 整树作废 */
  maxChildren: 24,
  /** 单段文本上限（超出截断） */
  maxText: 120,
  /** 单条样式值上限（超出丢弃该属性，不影响其余样式） */
  maxStyleValue: 64,
  /** img 地址上限（含 scheme） */
  maxSrc: 512,
  /** 多页视图的页数上限：点不过来，也容易撑破气泡容量（1 页 = 不可点） */
  maxViews: 4,
} as const;

/**
 * 递归解析/校验一个节点（外部输入 → 视图树）。
 *
 * 失败策略：**任一节点不合法 → 整棵树返回 null**。部分渲染会得到一棵"缺了一块"的气泡，
 * 比这一拍不显示更容易误导人；而样式的单个属性非法只丢那一条（不值得为此整树作废）。
 *
 * @param depth 当前深度（根 = 0）
 * @param budget 全树节点计数（跨递归共享）
 * @returns 合法节点；不合法返回 null（调用方据此整拍跳过）
 */
function parseCustomNode(raw: unknown, depth: number, budget: { nodes: number }): CustomNode | null {
  if (!raw || typeof raw !== 'object') return null;
  if (depth >= CUSTOM_LIMITS.maxDepth) return null;
  budget.nodes += 1;
  if (budget.nodes > CUSTOM_LIMITS.maxNodes) return null;

  const n = raw as Record<string, unknown>;
  const tag = typeof n.tag === 'string' ? n.tag : '';
  if (!CUSTOM_TAGS.includes(tag as CustomTag)) return null;

  const node: CustomNode = { tag: tag as CustomTag };

  // 文本：超长截断而不作废（第三方写得长是常见情况，截断后气泡仍然可读）
  if (typeof n.text === 'string' && n.text.length > 0) node.text = n.text.slice(0, CUSTOM_LIMITS.maxText);

  // img：地址只认 http/https（`file:` 会让渲染进程能读本地任意文件），且长度有上限
  if (tag === 'img') {
    const src = typeof n.src === 'string' ? n.src.trim() : '';
    if (!/^https?:\/\//i.test(src) || src.length > CUSTOM_LIMITS.maxSrc) return null;
    node.src = src;
  }

  // 样式：键走白名单，值逐条过滤（超长/含外部资源引用/空值 → 丢这一条）
  if (n.style && typeof n.style === 'object' && !Array.isArray(n.style)) {
    const style: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.style as Record<string, unknown>)) {
      if (!CUSTOM_STYLE_KEYS.has(k)) continue;
      if (typeof v !== 'string') continue;
      const value = v.trim();
      if (value === '' || value.length > CUSTOM_LIMITS.maxStyleValue) continue;
      if (BANNED_STYLE_VALUE.test(value)) continue;
      style[k] = value;
    }
    if (Object.keys(style).length > 0) node.style = style;
  }

  // 子节点：数量超限 = 整树作废；任一子节点非法同样整树作废（见上）
  if (Array.isArray(n.children)) {
    if (n.children.length > CUSTOM_LIMITS.maxChildren) return null;
    const children: CustomNode[] = [];
    for (const child of n.children) {
      const parsed = parseCustomNode(child, depth + 1, budget);
      if (parsed === null) return null;
      children.push(parsed);
    }
    if (children.length > 0) node.children = children;
  }

  return node;
}

/**
 * 可选数字：缺省 → undefined；出现但非法 → null（调用方据此整拍跳过——不把 NaN/字符串送进展示层）。
 */
function optNum(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * host 的余额原始响应（`BalanceResult`，经 `/state` 的 `sections.balance` 叶子送达）→ 客户端视图。
 *
 * 形状非法 / shape 不认识 → **null**（消费端跳过这一拍）——注意这里**不抛**：它跑在 1s 轮询里，
 * 抛异常会把整拍打断（其余叶子也跟着不渲染）。取数失败（HTTP/网络）不在这里发生：取数在 host，
 * 失败会以 `ok:false` 写进 S，由这里正常映射成"不可用"状态。
 */
export function toBalanceState(raw: unknown): BalanceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawBalanceResult;
  const provider = String(r.provider ?? 'unknown');
  if (r.ok !== true) {
    const reason =
      r.reason === 'unsupported' || r.reason === 'credential-missing' || r.reason === 'fetch-error'
        ? r.reason
        : 'fetch-error';
    return { provider, ok: false, reason, message: typeof r.message === 'string' ? r.message : undefined };
  }

  const d = r.data;
  if (!d || typeof d !== 'object') return null;

  if (r.shape === 'windows') {
    const monthly = optNum(d.monthly);
    const rolling = optNum(d.rolling);
    const weekly = optNum(d.weekly);
    const rollingCapUsd = optNum(d.rollingCapUsd);
    const weeklyCapUsd = optNum(d.weeklyCapUsd);
    const monthlyCapUsd = optNum(d.monthlyCapUsd);
    // 月度窗口是这份数据的底线：缺了/非法 = 认不出响应（滚动窗与周窗口、各窗口额度都是可选）
    if (monthly === undefined || monthly === null) return null;
    // 出现但非法（optNum 返回 null）→ 整拍跳过，不把坏数字送进展示层
    if (
      rolling === null ||
      weekly === null ||
      rollingCapUsd === null ||
      weeklyCapUsd === null ||
      monthlyCapUsd === null
    ) {
      return null;
    }
    return {
      provider,
      shape: 'windows',
      ok: true,
      rolling,
      weekly,
      monthly,
      rollingCapUsd,
      weeklyCapUsd,
      monthlyCapUsd,
      rollingLabel: typeof d.rollingLabel === 'string' && d.rollingLabel.length > 0 ? d.rollingLabel : undefined,
      rollingResetsAt: typeof d.rollingResetsAt === 'string' ? d.rollingResetsAt : undefined,
      weeklyResetsAt: typeof d.weeklyResetsAt === 'string' ? d.weeklyResetsAt : undefined,
      monthlyResetsAt: typeof d.monthlyResetsAt === 'string' ? d.monthlyResetsAt : undefined,
    };
  }
  if (r.shape === 'money') {
    // 多币种：每项必须有 currency + total；granted / toppedUp 缺省记 '0.00'（只用于展示分项，
    // 不参与档位），fullBalance 缺省 = 该币种没有基准。结构不合法的项直接丢弃——少一条币种比整拍不渲染好。
    const raw = Array.isArray(d.wallets) ? d.wallets : [];
    const wallets: MoneyWalletView[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const w = item as Record<string, unknown>;
      if (typeof w.currency !== 'string' || w.currency.length === 0) continue;
      if (typeof w.total !== 'string' || w.total.length === 0) continue;
      wallets.push({
        currency: w.currency,
        total: w.total,
        granted: typeof w.granted === 'string' && w.granted.length > 0 ? w.granted : '0.00',
        toppedUp: typeof w.toppedUp === 'string' && w.toppedUp.length > 0 ? w.toppedUp : '0.00',
        fullBalance: typeof w.fullBalance === 'string' && w.fullBalance.length > 0 ? w.fullBalance : undefined,
      });
    }
    // 一个钱包都没有 = 认不出响应（host 侧空钱包是按 fetch-error 写的，走到这里说明结构坏了）
    if (wallets.length === 0) return null;
    return {
      provider,
      shape: 'money',
      ok: true,
      wallets,
      tier: d.tier === 'peak' || d.tier === 'idle' ? d.tier : undefined,
    };
  }
  if (r.shape === 'points') {
    // points：unit + total 缺一不可 —— 没有单位拼不出「800 积分」，没有数字更无从展示。
    // full 缺省 = 没有基准（不参与档位折算）；空串按缺省处理，与 money 的 fullBalance 同口径。
    if (typeof d.unit !== 'string' || d.unit.length === 0) return null;
    if (typeof d.total !== 'string' || d.total.length === 0) return null;
    return {
      provider,
      shape: 'points',
      ok: true,
      points: {
        unit: d.unit,
        total: d.total,
        full: typeof d.full === 'string' && d.full.length > 0 ? d.full : undefined,
      },
    };
  }
  if (r.shape === 'custom') {
    // 两种写法归一：`views`（多页，优先）或 `rows` + 可选 `detailRows`（老两页写法）。
    // 两种都给时以 views 为准 —— 老字段只是兼容，别让"新旧混用"变成整拍失败。
    let views: CustomNode[] = [];
    if (Array.isArray(d.views) && d.views.length > 0) {
      if (d.views.length > CUSTOM_LIMITS.maxViews) return null;
      for (const raw of d.views) {
        const page = parseCustomNode(raw, 0, { nodes: 0 });
        // 任一页非法 → 整拍跳过：不做"前几页正常、翻到后面崩"的半坏状态
        if (!page) return null;
        views.push(page);
      }
    } else {
      const rows = parseCustomNode(d.rows, 0, { nodes: 0 });
      if (!rows) return null;
      views = [rows];
      if (d.detailRows !== undefined) {
        const detail = parseCustomNode(d.detailRows, 0, { nodes: 0 });
        // 给了却非法 → 整拍跳过：静默丢掉"可切页"会让第三方以为点了有效果
        if (!detail) return null;
        views.push(detail);
      }
    }
    // 百分比：夹到 0-100（超出范围是数据错误，不是"耗尽"或"未消耗"的语义）；非法 → 不播档位动画
    const pct =
      typeof d.percent === 'number' && Number.isFinite(d.percent) ? Math.max(0, Math.min(100, d.percent)) : undefined;
    return { provider, shape: 'custom', ok: true, custom: { views, percent: pct } };
  }
  return null;
}
