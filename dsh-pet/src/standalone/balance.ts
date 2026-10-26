/**
 * 独立模式的余额查询 —— 从「用户自己填的那份 AI 设置」出发。
 *
 * 【为什么不能直接用 host/balance 里那几张表】
 * 那边的登记表按 **DSH 的 provider id** 寻址（`deepseek-official` / `commandcode` /
 * `opencode-go` / `deepseek-account`），而独立模式的 id 恒为 `standalone`（见 ai-provider.ts）。
 * 两个命名空间天然对不上，于是 `queryBalance('standalone')` 永远落到 `unsupported`，
 * 桌宠第一次刷新就弹「当前服务商暂不支持余额查询」。
 *
 * 但"不支持"是假的：用户填的 baseUrl 就是 `https://api.deepseek.com/v1`，
 * 官方余额接口（`GET /user/balance`，Bearer）就在那儿等着。
 *
 * 【做法】走项目自带的第三方注册通道（`registerBalanceProvider`），把 `standalone` 这一个 id
 * 接上——请求怎么发、响应怎么解析，全在这里自己写，不搬 `providers/` 下任何一份实现：
 *   - 独立模式的处境不一样：没有 DSH 凭证存储，key 在用户自己的设置里；
 *   - 认哪家服务商也由这里自己判（看 baseUrl 的 host），不依赖宿主报告；
 *   - 只有真正有余额接口的服务商才登记，其余照旧 `unsupported`，绝不编一个数字出来。
 */

/** 查询所需的最小上下文（只这两项，别的都不该进这个函数） */
export interface BalanceCredentials {
  baseUrl: string;
  apiKey: string;
}

/** 一个币种的余额，字段与 host/balance 的展示契约一致（不做换算、不重算总额） */
export interface WalletSnapshot {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
}

/** 金额必须是接口给的十进制字符串：`undefined` / 空串 / 乱码一律拒绝，不兜底成 "0.00" */
function amount(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : undefined;
}

/**
 * DeepSeek 官方：`GET /user/balance`。
 *
 * 响应形如 `{ is_available, balance_infos: [{ currency, total_balance,
 * granted_balance, topped_up_balance }] }`。`balance_infos` 是**按币种分条的数组**
 * （同一个账户可能同时有 CNY 和 USD），逐条搬出去——只取第一个会让另一个币种凭空消失。
 */
export async function parseDeepSeekBalance(body: unknown): Promise<WalletSnapshot[]> {
  const infos = (body as { balance_infos?: unknown } | null)?.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error('余额接口没有返回 balance_infos（可能这把 key 没有查询权限）');
  }
  const wallets = infos.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const currency = typeof item.currency === 'string' ? item.currency.trim().toUpperCase() : '';
    const total = amount(item.total_balance);
    const granted = amount(item.granted_balance);
    const toppedUp = amount(item.topped_up_balance);
    if (!currency || total === undefined || granted === undefined || toppedUp === undefined) {
      throw new Error(`余额接口第 ${index + 1} 条数据字段不全，无法展示`);
    }
    return { currency, total, granted, toppedUp };
  });
  return wallets;
}

/** 认得出来的服务商：host 精确匹配（不用 includes，避免 api.deepseek.com.evil.tld 这类伪造） */
export interface BalanceSource {
  /** 展示用名称，出现在失败提示里 */
  name: string;
  /** baseUrl → 余额接口地址；不属于这家就返回 undefined */
  endpoint(baseUrl: URL): string | undefined;
  parse(body: unknown): Promise<WalletSnapshot[]>;
}

const SOURCES: BalanceSource[] = [
  {
    name: 'DeepSeek 官方',
    endpoint: (base) =>
      base.hostname === 'api.deepseek.com' ? new URL('/user/balance', base.origin).toString() : undefined,
    parse: parseDeepSeekBalance,
  },
];

/** baseUrl 归一化：必须有协议与主机；末尾斜杠不影响 origin */
export function normalizeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('AI 设置里的接口地址不是合法 URL，无法查询余额');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AI 设置里的接口地址必须是 http(s)');
  }
  return url;
}

/**
 * 查一次余额。
 *
 * 成功 → `{ ok: true, shape: 'money' }`（provider 由调用方回填）；
 * 任何失败 → 抛错，由 host/balance 统一落成 `fetch-error`，绝不返回伪造的 0。
 *
 * @param fetcher 可注入的 fetch（单测不碰网络）；生产用全局 fetch
 * @param timeoutMs 单次请求上限，默认 8s —— 余额是后台装饰，不能拖住对话
 */
export async function queryStandaloneBalance(
  credentials: BalanceCredentials,
  fetcher: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<{ shape: 'money'; data: { wallets: WalletSnapshot[] } }> {
  const key = credentials.apiKey.trim();
  if (!key) throw new Error('还没有填 API Key，无法查询余额');
  const base = normalizeBaseUrl(credentials.baseUrl);
  const source = SOURCES.find((item) => item.endpoint(base) !== undefined);
  if (!source) {
    throw new Error(`「${base.hostname}」没有公开的余额查询接口`);
  }
  const endpoint = source.endpoint(base) as string;

  const response = await fetcher(endpoint, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    // 401/403 说明 key 不对或过期；其余按状态码报，够定位就行
    if (response.status === 401 || response.status === 403) {
      throw new Error('余额接口拒绝了这把 API Key（401/403），请到 AI 设置里重新填写');
    }
    throw new Error(`${source.name}余额接口返回 HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  const wallets = await source.parse(body);
  return { shape: 'money', data: { wallets } };
}

/** 该服务商到底能不能查余额（给设置页/日志提前判断用，不发请求） */
export function balanceSupported(baseUrl: string): boolean {
  try {
    const base = normalizeBaseUrl(baseUrl);
    return SOURCES.some((item) => item.endpoint(base) !== undefined);
  } catch {
    return false;
  }
}
