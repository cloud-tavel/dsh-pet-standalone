/**
 * 独立模式余额查询的单测 —— 全程不碰网络（fetch 由用例注入）。
 *
 * 覆盖三件容易出错的事：
 *   ① 金额必须来自接口，缺一个字段就报错，绝不兜底成 "0.00"；
 *   ② 只认自己列出来的服务商（host 精确匹配），别的 host 明确说不支持；
 *   ③ HTTP 失败要能一句话说清是 key 的问题还是服务端的问题。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { balanceSupported, normalizeBaseUrl, parseDeepSeekBalance, queryStandaloneBalance } from './balance.ts';

const deepseekBody = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
};

/** 一个只回固定响应的假 fetch，同时把收到的 URL/头记下来供断言 */
function fakeFetch(
  status: number,
  body: unknown,
): { fetcher: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test('parseDeepSeekBalance：单币种原样搬出，不重算总额', async () => {
  const wallets = await parseDeepSeekBalance(deepseekBody);
  assert.deepEqual(wallets, [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }]);
});

test('parseDeepSeekBalance：多币种逐条保留（只取 [0] 会让另一个币种凭空消失）', async () => {
  const wallets = await parseDeepSeekBalance({
    balance_infos: [
      { currency: 'usd', total_balance: '5.00', granted_balance: '0.00', topped_up_balance: '5.00' },
      { currency: 'CNY', total_balance: '12.34', granted_balance: '2.34', topped_up_balance: '10.00' },
    ],
  });
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0].currency, 'USD', '币种统一大写，避免展示层大小写漂移');
  assert.equal(wallets[1].total, '12.34');
});

test('parseDeepSeekBalance：缺字段 / 金额不是数字字符串 → 报错，不伪造 0', async () => {
  await assert.rejects(
    () => parseDeepSeekBalance({ balance_infos: [{ currency: 'CNY', total_balance: '1.00' }] }),
    /字段不全/,
  );
  await assert.rejects(
    () =>
      parseDeepSeekBalance({
        balance_infos: [{ currency: 'CNY', total_balance: 'abc', granted_balance: '0.00', topped_up_balance: '0.00' }],
      }),
    /字段不全/,
  );
  await assert.rejects(() => parseDeepSeekBalance({ balance_infos: [] }), /balance_infos/);
  await assert.rejects(() => parseDeepSeekBalance({}), /balance_infos/);
});

test('queryStandaloneBalance：打到 /user/balance，带 Bearer，成功给出 money 形状', async () => {
  const { fetcher, calls } = fakeFetch(200, deepseekBody);
  const result = await queryStandaloneBalance({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }, fetcher);
  assert.equal(result.shape, 'money');
  assert.equal(result.data.wallets[0].total, '110.00');
  assert.equal(calls[0].url, 'https://api.deepseek.com/user/balance', 'baseUrl 的 /v1 要丢掉，换成正统接口路径');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer sk-test');
});

test('queryStandaloneBalance：401/403 说清是 key 的问题', async () => {
  const { fetcher } = fakeFetch(401, {});
  await assert.rejects(
    () => queryStandaloneBalance({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-bad' }, fetcher),
    /API Key/,
  );
});

test('queryStandaloneBalance：其它状态码带出码值，别吞成"未知错误"', async () => {
  const { fetcher } = fakeFetch(503, {});
  await assert.rejects(
    () => queryStandaloneBalance({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }, fetcher),
    /HTTP 503/,
  );
});

test('queryStandaloneBalance：不认识的 host 直接说不支持，一个请求都不发', async () => {
  const { fetcher, calls } = fakeFetch(200, deepseekBody);
  await assert.rejects(
    () => queryStandaloneBalance({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' }, fetcher),
    /没有公开的余额查询接口/,
  );
  assert.equal(calls.length, 0);
});

test('queryStandaloneBalance：没填 key 时不发请求', async () => {
  const { fetcher, calls } = fakeFetch(200, deepseekBody);
  await assert.rejects(
    () => queryStandaloneBalance({ baseUrl: 'https://api.deepseek.com/v1', apiKey: '  ' }, fetcher),
    /API Key/,
  );
  assert.equal(calls.length, 0);
});

test('normalizeBaseUrl：非法/非 http(s) 地址给明确错误', () => {
  assert.throws(() => normalizeBaseUrl('not a url'), /不是合法 URL/);
  assert.throws(() => normalizeBaseUrl('ftp://api.deepseek.com'), /http\(s\)/);
  assert.equal(normalizeBaseUrl(' https://api.deepseek.com/v1 ').hostname, 'api.deepseek.com');
});

test('balanceSupported：只对认得出来的服务商说 true', () => {
  assert.equal(balanceSupported('https://api.deepseek.com/v1'), true);
  assert.equal(balanceSupported('https://api.deepseek.com.evil.test/v1'), false, 'host 必须精确匹配');
  assert.equal(balanceSupported('https://api.openai.com/v1'), false);
  assert.equal(balanceSupported(''), false);
});
