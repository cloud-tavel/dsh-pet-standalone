import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVision, VISION_MIN_INTERVAL_MS, VISION_TTL_MS } from './vision.ts';

const silent = { debug() {}, warn() {} };

/** 可编程假截屏：每次调用返回 data URL（内容带序号便于区分），或抛错/返回 undefined */
function fakeCapture(options: { fail?: boolean; empty?: boolean; ms?: number; log?: string[]; size?: number }) {
  let n = 0;
  return async (): Promise<string | undefined> => {
    if (options.log) options.log.push('capture#' + ++n);
    if (options.fail) throw new Error('capture exploded');
    if (options.empty) return undefined;
    const size = options.size ?? 1000;
    return 'data:image/jpeg;base64,' + 'A'.repeat(size) + '#' + n;
  };
}

test('take() captures once and serves 30s cache without re-capturing', async () => {
  let clock = 1_000_000;
  const log: string[] = [];
  const vision = createVision({
    capture: fakeCapture({ log }),
    enabled: () => true,
    logger: silent,
    now: () => clock,
  });
  const first = await vision.take();
  assert.match(first ?? '', /^data:image\/jpeg;base64,/);
  assert.deepEqual(log, ['capture#1']);
  // 缓存期内再取：0 次新截屏
  const second = await vision.take();
  assert.equal(second, first);
  assert.deepEqual(log, ['capture#1']);
  assert.equal(vision.state().cacheHits, 1);
  // 过期后重新截
  clock += VISION_TTL_MS + 1;
  await vision.take();
  assert.deepEqual(log, ['capture#1', 'capture#2']);
});

test('disabled switch: take/prefetch never capture, cache is wiped (关了就清)', async () => {
  let enabled = true;
  const clock = 1_000_000;
  const log: string[] = [];
  const vision = createVision({
    capture: fakeCapture({ log }),
    enabled: () => enabled,
    logger: silent,
    now: () => clock,
  });
  await vision.take();
  assert.deepEqual(log, ['capture#1']);
  enabled = false;
  assert.equal(await vision.take(), undefined);
  assert.deepEqual(log, ['capture#1']);
  assert.equal(vision.state().bytes, undefined);
  // 重新打开：缓存里已无旧画面，必须重截（不能拿关闭期间的旧图充数）
  enabled = true;
  const again = await vision.take();
  assert.match(again ?? '', /#2$/);
  assert.deepEqual(log, ['capture#1', 'capture#2']);
});

test('capture failure degrades to undefined and does not throw; concurrent capture is deduped', async () => {
  const vision = createVision({ capture: fakeCapture({ fail: true }), enabled: () => true, logger: silent });
  assert.equal(await vision.take(), undefined);
  assert.equal(vision.state().failures, 1);
  assert.equal(await vision.take(), undefined);

  // 并发去重：两个 take() 同时进行只触发一次截屏
  let slow = 0;
  const slowVision = createVision({
    capture: async () => {
      slow += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 'data:image/jpeg;base64,frame' + slow;
    },
    enabled: () => true,
    logger: silent,
  });
  const [a, b] = await Promise.all([slowVision.take(), slowVision.take()]);
  assert.equal(a, b);
  assert.equal(slow, 1);
});

test('prefetch warms the cache; take() right after is a 0-capture cache hit', async () => {
  const clock = 1_000_000;
  const log: string[] = [];
  const vision = createVision({
    capture: fakeCapture({ log }),
    enabled: () => true,
    logger: silent,
    now: () => clock,
  });
  vision.prefetch();
  await Promise.resolve(); // 让 prefetch 的截屏 promise 跑起来
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(log, ['capture#1']);
  const url = await vision.take();
  assert.match(url ?? '', /#1$/);
  assert.deepEqual(log, ['capture#1']);
});

test('min interval: a stale-but-recent capture is not re-captured within 1.5s (take yields nothing)', async () => {
  let clock = 1_000_000;
  const log: string[] = [];
  const vision = createVision({
    capture: fakeCapture({ log }),
    enabled: () => true,
    logger: silent,
    now: () => clock,
    ttlMs: 10, // 极短 TTL：下一拍立即过期
  });
  await vision.take();
  assert.deepEqual(log, ['capture#1']);
  clock += 11; // 过期了，但距上次截屏 < 1.5s
  assert.equal(await vision.take(), undefined);
  assert.deepEqual(log, ['capture#1']);
  clock += VISION_MIN_INTERVAL_MS;
  await vision.take();
  assert.deepEqual(log, ['capture#1', 'capture#2']);
});

test('clear() drops the cache; capture timeout races to undefined', async () => {
  const vision = createVision({ capture: fakeCapture({}), enabled: () => true, logger: silent });
  await vision.take();
  assert.ok(vision.state().bytes);
  vision.clear();
  assert.equal(vision.state().bytes, undefined);
  assert.equal(vision.state().fresh, false);

  // 截屏挂死：竞速超时后返回 undefined，不让调用方干等
  const hung = createVision({
    capture: () => new Promise<string>(() => {}),
    enabled: () => true,
    logger: silent,
    captureTimeoutMs: 30,
  });
  const started = Date.now();
  assert.equal(await hung.take(), undefined);
  assert.ok(Date.now() - started < 2_000);
});
