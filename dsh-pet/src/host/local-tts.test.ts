import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_TTS_MAX_AUDIO_BYTES, LOCAL_TTS_MAX_TEXT, isLocalTtsEndpoint, synthesizeLocalTts } from './local-tts.ts';

const WAV = Buffer.from('RIFFxxxxWAVEfmt ');

/** 可编程假 fetcher：记录请求，按预设返回 Response 或抛错 */
function fakeFetch(
  plan:
    | { status?: number; contentType?: string; body?: Buffer | string; throws?: 'abort' | 'network' }
    | ((url: string, init: RequestInit) => Response | Promise<Response>),
  log?: { url: string; init: RequestInit }[],
): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (log) log.push({ url, init: init ?? {} });
    if (typeof plan === 'function') return plan(url, init ?? {});
    if (plan.throws === 'abort') throw new DOMException('aborted', 'AbortError');
    if (plan.throws === 'network') throw new Error('ECONNREFUSED');
    return new Response(plan.body ?? WAV, {
      status: plan.status ?? 200,
      headers: { 'content-type': plan.contentType ?? 'audio/wav' },
    });
  };
  return impl as unknown as typeof fetch;
}

test('isLocalTtsEndpoint accepts clean http(s) origins and rejects junk', () => {
  assert.equal(isLocalTtsEndpoint('http://127.0.0.1:7861'), true);
  assert.equal(isLocalTtsEndpoint('https://tts.example.com'), true);
  assert.equal(isLocalTtsEndpoint('http://127.0.0.1:7861/'), true);
  assert.equal(isLocalTtsEndpoint(''), false);
  assert.equal(isLocalTtsEndpoint('  http://127.0.0.1:7861'), false);
  assert.equal(isLocalTtsEndpoint('ftp://127.0.0.1'), false);
  assert.equal(isLocalTtsEndpoint('http://user:pw@127.0.0.1:7861'), false);
  assert.equal(isLocalTtsEndpoint('http://127.0.0.1:7861/say?text=x'), false);
  assert.equal(isLocalTtsEndpoint('http://127.0.0.1:7861#x'), false);
  assert.equal(isLocalTtsEndpoint('not a url'), false);
});

test('synthesizeLocalTts posts text/speed to {endpoint}/say and returns the audio bytes', async () => {
  const log: { url: string; init: RequestInit }[] = [];
  const result = await synthesizeLocalTts({
    endpoint: 'http://127.0.0.1:7861/',
    text: '  这波打得漂亮  ',
    speed: 1.2,
    fetcher: fakeFetch({ contentType: 'audio/wav' }, log),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contentType, 'audio/wav');
  assert.equal(result.audio.length, WAV.length);
  assert.equal(log.length, 1);
  assert.equal(log[0]?.url, 'http://127.0.0.1:7861/say');
  assert.equal(log[0]?.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(log[0]?.init.body)), { text: '这波打得漂亮', lang: 'zh', speed: 1.2 });
});

test('synthesizeLocalTts accepts base64 audio wrapped in JSON', async () => {
  const payload = JSON.stringify({ ok: true, audio_base64: WAV.toString('base64'), content_type: 'audio/mpeg' });
  const result = await synthesizeLocalTts({
    endpoint: 'http://127.0.0.1:7861',
    text: '你好',
    fetcher: fakeFetch({ contentType: 'application/json', body: payload }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(result.audio.toString(), WAV.toString());
});

test('synthesizeLocalTts accepts data: URLs inside the JSON field', async () => {
  const payload = JSON.stringify({ audio: 'data:audio/wav;base64,' + WAV.toString('base64') });
  const result = await synthesizeLocalTts({
    endpoint: 'http://127.0.0.1:7861',
    text: '你好',
    fetcher: fakeFetch({ contentType: 'application/json', body: payload }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.audio.toString(), WAV.toString());
});

test('synthesizeLocalTts reports http status, non-audio bodies and empty audio', async () => {
  const base = { endpoint: 'http://127.0.0.1:7861', text: '一句' };

  const refused = await synthesizeLocalTts({ ...base, fetcher: fakeFetch({ status: 503 }) });
  assert.deepEqual(refused, { ok: false, reason: 'http-503' });

  const html = await synthesizeLocalTts({
    ...base,
    fetcher: fakeFetch({ contentType: 'text/html', body: '<html>oops</html>' }),
  });
  assert.deepEqual(html, { ok: false, reason: 'not-audio' });

  const empty = await synthesizeLocalTts({ ...base, fetcher: fakeFetch({ body: Buffer.alloc(0) }) });
  assert.deepEqual(empty, { ok: false, reason: 'empty-audio' });

  const big = await synthesizeLocalTts({
    ...base,
    fetcher: fakeFetch({ body: Buffer.alloc(LOCAL_TTS_MAX_AUDIO_BYTES + 1) }),
  });
  assert.deepEqual(big, { ok: false, reason: 'too-large' });
});

test('synthesizeLocalTts maps network failures and timeouts without throwing', async () => {
  const base = { endpoint: 'http://127.0.0.1:7861', text: '一句' };

  const offline = await synthesizeLocalTts({ ...base, fetcher: fakeFetch({ throws: 'network' }) });
  assert.deepEqual(offline, { ok: false, reason: 'network' });

  // 不是我们 abort 的 AbortError（对端自己中断）：归到 network，不算超时
  const aborted = await synthesizeLocalTts({ ...base, fetcher: fakeFetch({ throws: 'abort' }) });
  assert.deepEqual(aborted, { ok: false, reason: 'network' });
});

test('synthesizeLocalTts aborts a slow service instead of waiting forever', async () => {
  const started = Date.now();
  const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const result = await synthesizeLocalTts({
    endpoint: 'http://127.0.0.1:7861',
    text: '一句',
    timeoutMs: 60,
    fetcher: hang,
  });
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 2_000, '超时应该按时收口');
});

test('synthesizeLocalTts rejects bad input before touching the network', async () => {
  const log: { url: string; init: RequestInit }[] = [];
  const fetcher = fakeFetch({}, log);

  assert.deepEqual(await synthesizeLocalTts({ endpoint: 'http://127.0.0.1:7861', text: '   ', fetcher }), {
    ok: false,
    reason: 'empty-text',
  });
  assert.deepEqual(
    await synthesizeLocalTts({ endpoint: 'http://127.0.0.1:7861', text: 'x'.repeat(LOCAL_TTS_MAX_TEXT + 1), fetcher }),
    { ok: false, reason: 'text-too-long' },
  );
  assert.deepEqual(await synthesizeLocalTts({ endpoint: 'localhost:7861', text: '你好', fetcher }), {
    ok: false,
    reason: 'bad-endpoint',
  });
  assert.equal(log.length, 0, '参数不合法时不该发请求');
});
