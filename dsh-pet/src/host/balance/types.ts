/**
 * 余额查询的契约层：服务商定义、取数上下文、路由结果、各形态的数据形状。
 *
 * 这里**只放形状与契约**，不放任何具体服务商的知识 —— 接口地址、业务额度、计价规则、响应解析
 * 都在 `./providers/<名>.ts` 里各自一份。加一个服务商 = 加一个 provider 文件 + 在 `./index.ts`
 * 的注册表里加一行；本文件与 src/shared 都不用动。
 */

// ---------- 服务商定义（加服务商只需要实现这一个接口） ----------

/**
 * 凭证来源。
 * - `ref`：DSH credentialRef 名（如 `OPENCODE_GO_API_KEY`）—— 由调用方经 `ctx.credentials.resolve`
 *   解析后注入，插件自己不读凭证存储；
 * - `none`：该路由**没有** API Key（账号路由）。凭证是 DSH 账号服务持有的授权记录，只能经服务
 *   查询，见 ./providers/deepseek-account.ts。
 */
export type CredentialSpec = { mode: 'ref'; ref: string } | { mode: 'none' };

/**
 * 取数上下文：所有服务商的 `fetch` 收到的都是**同一个**形状，各取所需。
 * - `key`：已解析的 API Key（`credential.mode === 'ref'` 时保证非空）；`mode === 'none'` 时为空串；
 * - `resolveAccount`：账号余额查询；只有账号路由会读它，其余路由忽略。
 */
export interface BalanceFetchContext {
  /** 命中的 provider id（原样回填进结果，展示层据此区分服务商） */
  provider: string;
  /** 已解析的 API Key；`credential.mode === 'none'` 的路由为空串（它不读这个字段） */
  key: string;
  /** 账号余额查询（调用方注入 ctx.deepseekAccount.getBalance）；仅 `mode === 'none'` 使用 */
  resolveAccount?: () => Promise<AccountBalanceSnapshot | null | undefined>;
}

/**
 * 第三方注册进来的 provider（对外契约）：只有 id + 取数。
 * 拿不到宿主解析的 key，也拿不到 `resolveAccount` —— 上下文里只有 `provider`；
 * 凭证由注册方在自己的插件里解决（读自己的配置/环境变量，或根本不需要）。
 */
export interface PluginProvider {
  /** 命中的 provider id（必须与 agentDefaultModel 报告的 id 完全一致）。 */
  id: string;
  /** 取数 + 解析；只负责成功路径，任何失败一律 `throw`，由 `queryBalance` 统一落成 `fetch-error`。 */
  fetch(ctx: PluginFetchContext): Promise<BalanceSuccess>;
}

/** 第三方取数上下文：只有 provider（没有 key，没有 resolveAccount）。 */
export interface PluginFetchContext {
  /** 命中的 provider id（原样回填进结果，展示层据此区分服务商）。 */
  provider: string;
}

/**
 * 一个**内置** service provider 的余额查询定义 —— **一行 = 一个自包含服务商**。
 * 接口地址、业务常量、响应解析全在它自己的文件里（见 ./providers/）。
 */
export interface BalanceProvider {
  /** 可命中的 provider id（agentDefaultModel 报告的 id） */
  id: string;
  /** 凭证来源（决定 queryBalance 是解析凭证还是调服务） */
  credential: CredentialSpec;
  /**
   * 取数 + 解析。**只负责成功路径**：任何失败（HTTP 非 2xx、字段缺失/非法、未登录、无钱包…）一律
   * `throw`，由 `queryBalance` 统一落成 `fetch-error`。这样所有服务商的失败口径完全一致，也不可能
   * 静默伪造 0 余额。
   */
  fetch(ctx: BalanceFetchContext): Promise<BalanceSuccess>;
}

// ---------- 展示形态（wire 契约：host 写进叶子，两端展示层按它选渲染分支） ----------

/**
 * 展示形态 —— 三种内置 + 一种「完全自定义」，且**不含任何服务商信息**：
 * - `windows`：三窗口用量（百分比 + 重置倒计时）→ 气泡「X额度已用 N%」
 * - `money`：账户金额 → 气泡「余额（峰/谷）¥x.xx」
 * - `points`：积分/点数余额（非货币）→ 气泡「余额 800 积分」
 * - `custom`：第三方自己拼的节点树（见 CustomBalance）—— 形态怪到内置三种都装不下的服务商走这里，
 *   插件不必为它加一个 provider 文件，也不用改展示层
 *
 * 积分单列一种形态而不是借用 money：`granted`/`toppedUp`（充值/赠送）在积分里没有意义，
 * 硬塞等于在 wire 契约上写假数据。单列之后 `unit` 只承担「数字后面的后缀」这一个职责，
 * `currency` 继续只表示币种代码。
 *
 * 自定义形态单列的理由不同：它把**布局**也交给服务商，所以内置三种的"行数据"表达不了它
 * （见 src/shared/balance/handlers/custom.ts）。
 */
export type BalanceShape = 'windows' | 'money' | 'points' | 'custom';

/**
 * 自定义气泡节点（`shape: 'custom'`）：第三方交来的一棵声明式布局树。
 *
 * 与 src/shared/balance/types.ts 的 CustomNode 同构（本文件与 shared 各声明一份：DSH 单文件
 * 加载约束下 host 不 import 展示层）。合法 tag、样式白名单与容量上限在客户端的解析层强制执行
 * （src/shared/balance/parse.ts），host 侧只负责把结构原样写进叶子。
 */
export type CustomTag = 'div' | 'span' | 'i' | 'b' | 'strong' | 'em' | 'img';

export interface CustomNode {
  tag: CustomTag;
  text?: string;
  /** 仅 `img`：http/https 地址 */
  src?: string;
  /** camelCase 内联样式 */
  style?: Record<string, string>;
  children?: CustomNode[];
}

/** `shape: 'custom'` 的载荷：多页视图（或老两页写法）+ 可选档位百分比 */
export interface CustomBalance {
  /**
   * 多页视图（推荐）：1~4 项，第 1 项为初始页。点击气泡循环切页（末页回第一页）；
   * 只有 1 页时气泡不可点。每页都是一棵 CustomNode。
   */
  views?: CustomNode[];
  /** 单页/两页写法（与 views 二选一）：收起态树。`detailRows` 给了就等价于 `views: [rows, detailRows]` */
  rows?: CustomNode;
  detailRows?: CustomNode;
  /** 已用百分比（0-100，驱动档位动画）；缺省 = 不播 */
  percent?: number;
}

/** 计价档位装饰（气泡上的「峰/谷」）：由服务商按自己的计价规则算好后随数据带出 */
export type PricingTier = 'peak' | 'idle';

// ---------- 两种形态的数据 ----------

/**
 * 三窗口用量（`shape: 'windows'`）。opencode 与 commandcode 共用同一个形状，展示层因而共用同一套
 * 「取最紧迫窗口」逻辑。
 *
 * 字段语义：
 * - `monthly` **必有**（月度窗口是这份数据的底线）；`rolling`（滚动窗）/`weekly` 可缺省 ——
 *   缺省 = 该服务商没有这个窗口，**不是 0**。各服务商自己可以更严（如 opencode 在 provider 侧
 *   就要求三窗齐全），但展示层的底线只有月度；
 * - `*CapUsd` 为窗口满额度（USD）。三个都给得出时才按「剩余额度最少」做绝对口径比较，
 *   否则退化为「已用百分比最大」的相对口径；
 * - `rollingLabel` 为滚动窗的展示名（缺省 `5h`）。滚动窗时长是**服务商自己的业务事实**
 *   （opencode 与 commandcode 都是 5 小时），故由数据带出，展示层不写死；
 * - `*ResetsAt` 缺省按「已重置」处理。
 */
export interface WindowsUsage {
  monthly: number;
  rolling?: number;
  weekly?: number;
  rollingCapUsd?: number;
  weeklyCapUsd?: number;
  monthlyCapUsd?: number;
  rollingLabel?: string;
  rollingResetsAt?: string;
  weeklyResetsAt?: string;
  monthlyResetsAt?: string;
}

/**
 * 一个币种的余额（`shape: 'money'` 的数组元素）。DeepSeek 官方路由与 DSH 账号路由**同构**。
 *
 * - `total` / `granted` / `toppedUp`：金额字符串，与接口一致（不做换算、不重算）；
 * - `fullBalance`：**该币种的档位基准**（同 currency 单位）——余额 ≥ 该值视为未消耗。缺省 = 这个币种
 *   没有基准，**不参与档位折算**（不替它猜一个）。基准是服务商自己的业务事实（DeepSeek：CNY 20 / USD 5），
 *   故由数据带出、不写死在展示层；
 * - 账户可能同时持有多个币种（如「USD 0.00 + CNY 有余额」），所以是数组；不同币种的基准不能互换。
 */
export interface MoneyWallet {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
  fullBalance?: string;
}

/**
 * 账户金额（`shape: 'money'`）。
 *
 * `tier`：计价档位装饰（峰/谷）。**只有提供该规则的服务商会带**（DeepSeek 的高峰时段计价），
 * 不带就渲染成不带峰谷的「余额 ¥x.xx」。
 */
export interface MoneyBalance {
  wallets: MoneyWallet[];
  tier?: PricingTier;
}

/**
 * 积分/点数余额（`shape: 'points'`）。有些服务商（典型是本地网关）的余额不是货币，而是整数积分。
 *
 * 单列一种形态的理由：积分既不是窗口用量，也不该借 `money` 的字段——`granted`/`toppedUp`
 * （充值/赠送）在积分里没有意义，硬塞只能在 wire 契约上写假的 `'0.00'`。
 *
 * 字段语义：
 * - `unit`：展示单位（「积分」「点数」…）。与 `currency` 的分工：`currency` 是币种代码，
 *   `unit` 只是拼在数字后面的后缀，**不参与任何计算**；
 * - `total`：当前余额（字符串，与接口一致，不做换算、不重算）；
 * - `full`：**档位基准**（同 unit 的数值）——余额 ≥ 该值视为未消耗。缺省 = 没有基准，
 *   不参与百分比折算、不播档位动画（不替服务商猜一个）。基准是服务商自己的业务事实，
 *   故由数据带出、不写死在展示层。
 */
export interface PointsBalance {
  unit: string;
  total: string;
  full?: string;
}

/**
 * DSH 账号服务的余额快照（`ctx.deepseekAccount.getBalance()` 的返回，只取用到的字段）。
 * 与 `dsh-deepseek-account` 的 `AccountDetails['balance']` 同构：`ready` 带两个钱包数组，
 * `failed` 是"查过但失败"（与"没登录"的 null 不同）。
 */
export interface AccountBalanceSnapshot {
  status: 'ready' | 'failed';
  /** 充值钱包（normal_wallets），金额是保留服务端精度的十进制字符串 */
  value?: readonly { currency?: unknown; balance?: unknown }[];
  /** 赠送钱包（bonus_wallets） */
  bonusWallets?: readonly { currency?: unknown; balance?: unknown }[];
}

// ---------- 路由结果 ----------

/** 成功结果（client 端与 host 端同构使用）：`shape` 是展示形态，`provider` 是当前到底是谁 */
export type BalanceSuccess =
  | { ok: true; provider: string; shape: 'windows'; data: WindowsUsage }
  | { ok: true; provider: string; shape: 'money'; data: MoneyBalance }
  | { ok: true; provider: string; shape: 'points'; data: PointsBalance }
  | { ok: true; provider: string; shape: 'custom'; data: CustomBalance };

/**
 * 按当前服务商查询余额的结果。
 * 失败带 `reason` 与可选 `message` —— 绝不返回伪造数字（0 余额必须来自接口，不能来自兜底）。
 */
export type BalanceResult =
  | BalanceSuccess
  | { ok: false; provider: string; reason: 'unsupported' | 'credential-missing' | 'fetch-error'; message?: string };
