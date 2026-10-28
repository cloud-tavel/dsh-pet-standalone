import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCompanion,
  generateCompanion,
  hashDistance,
  hammingHex,
  normalizeSay,
  MIN_SAMPLE_INTERVAL_MS,
} from './companion.ts';

// 两个「完全不同」的 64 位指纹：0 与 f 全反
const BLACK = '0000000000000000';
const WHITE = 'ffffffffffffffff';
// 只差 1 位（最轻微的变化）
const NEAR_BLACK = '0000000000000001';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {} };

/** 造一个可控的 companion：probe/generate 由测试脚本驱动，speak 收集文本 */
function harness(options?: {
  enabled?: boolean;
  hashes?: Array<string | undefined>;
  generate?: (image: string) => Promise<string | undefined>;
  intervalMs?: number;
  cooldownMs?: number;
}) {
  const spoken: string[] = [];
  const generated: string[] = [];
  const queue = [...(options?.hashes ?? [])];
  let probeCalls = 0;
  const companion = createCompanion({
    enabled: () => options?.enabled !== false,
    probe: async () => {
      probeCalls += 1;
      return queue.length > 0 ? queue.shift() : undefined;
    },
    capture: async () => 'data:image/jpeg;base64,AAAA',
    generate: async (image) => {
      generated.push(image);
      return options?.generate ? options.generate(image) : '这波打得不错';
    },
    speak: (text) => spoken.push(text),
    logger: silentLogger,
    sampleIntervalMs: options?.intervalMs,
    cooldownMs: options?.cooldownMs,
  });
  return { companion, spoken, generated, probeCalls: () => probeCalls };
}

test('hammingHex counts differing bits and tolerates bad input', () => {
  assert.equal(hammingHex(BLACK, BLACK), 0);
  assert.equal(hammingHex(BLACK, NEAR_BLACK), 1);
  assert.equal(hammingHex(BLACK, WHITE), 64);
  // 非法字符按「跳过」处理，不抛错（脏指纹不该让整拍崩掉）
  assert.equal(hammingHex('zz', 'zz'), 0);
});

test('hashDistance normalizes to 0..1', () => {
  assert.equal(hashDistance(BLACK, BLACK), 0);
  assert.equal(hashDistance(BLACK, WHITE), 1);
  // 长度不一致时按较长者算分母，短指纹不会天然更「相似」
  assert.ok(hashDistance('00', 'ffffffffffffffff') > 0.9);
});

test('disabled: no probe at all, and state reports enabled=false', async () => {
  const { companion, probeCalls } = harness({ enabled: false });
  await companion.tick();
  await companion.tick();
  assert.equal(probeCalls(), 0);
  assert.equal(companion.state().enabled, false);
  assert.equal(companion.state().samples, 0);
});

test('first sample only establishes a baseline (no generation)', async () => {
  const { companion, generated } = harness({ hashes: [BLACK] });
  await companion.tick();
  assert.equal(companion.state().samples, 1);
  assert.equal(generated.length, 0);
});

test('small change stays quiet; big change triggers capture + generate + speak', async () => {
  const { companion, generated, spoken } = harness({ hashes: [BLACK, NEAR_BLACK, WHITE] });
  await companion.tick(); // 基线
  await companion.tick(); // 差 1 位 → 远低于 30% 阈值
  assert.equal(generated.length, 0);
  await companion.tick(); // 全反 → 100%
  assert.equal(generated.length, 1);
  assert.deepEqual(spoken, ['这波打得不错']);
  assert.equal(companion.state().triggers, 1);
  assert.equal(companion.state().spoken, 1);
});

test('cooldown suppresses a second trigger inside the window', async () => {
  let clock = 1_000_000;
  const hashes = [BLACK, WHITE, BLACK, WHITE, BLACK];
  const spoken: string[] = [];
  const companion = createCompanion({
    enabled: () => true,
    probe: async () => hashes.shift() ?? WHITE,
    capture: async () => 'data:image/jpeg;base64,AAAA',
    generate: async () => '好',
    speak: (text) => spoken.push(text),
    logger: silentLogger,
    now: () => clock,
    cooldownMs: 90_000,
  });
  await companion.tick(); // 基线
  clock += 10_000;
  await companion.tick(); // 触发第一次
  clock += 10_000;
  await companion.tick(); // 又变了，但冷却未到
  clock += 10_000;
  await companion.tick(); // 还是冷却未到
  assert.equal(spoken.length, 1);
  assert.equal(companion.state().triggers, 1);
  // 冷却过了之后应该能再说
  clock += 90_000;
  await companion.tick();
  assert.equal(spoken.length, 2);
});

test('SILENT (generate returns undefined) neither speaks nor burns the cooldown', async () => {
  const hashes = [BLACK, WHITE, BLACK];
  const spoken: string[] = [];
  const companion = createCompanion({
    enabled: () => true,
    probe: async () => hashes.shift() ?? BLACK,
    capture: async () => 'data:image/jpeg;base64,AAAA',
    generate: async () => undefined,
    speak: (text) => spoken.push(text),
    logger: silentLogger,
  });
  await companion.tick(); // 基线
  await companion.tick(); // 大变化 → 生成但模型说「不值得说」
  assert.equal(spoken.length, 0);
  const s = companion.state();
  assert.equal(s.silent, 1);
  assert.equal(s.spoken, 0);
  // 关键：没推进 lastSpokenAt，所以下一次变化立刻还能开口
  assert.equal(s.lastSpokenAt, undefined);
  await companion.tick();
  assert.equal(companion.state().silent, 2); // 又静默一次，仍然没有被冷却挡住
});

test('probe failure is counted and does not throw or clear the baseline', async () => {
  const { companion } = harness({ hashes: [BLACK, undefined, WHITE] });
  await companion.tick(); // 基线
  await companion.tick(); // 采样失败
  assert.equal(companion.state().probeFailures, 1);
  assert.equal(companion.state().samples, 1);
  await companion.tick(); // 与基线相比仍然是大变化
  assert.equal(companion.state().triggers, 1);
});

test('sample interval is clamped to the floor', () => {
  const companion = createCompanion({
    enabled: () => true,
    probe: async () => BLACK,
    capture: async () => undefined,
    generate: async () => undefined,
    speak: () => {},
    logger: silentLogger,
    sampleIntervalMs: 500, // 用户/配置想暴力采样（低于下限）
  });
  assert.equal(companion.state().sampleIntervalMs, MIN_SAMPLE_INTERVAL_MS);
});

test('sample interval getter returning undefined falls back to the default', () => {
  const companion = createCompanion({
    enabled: () => true,
    probe: async () => BLACK,
    capture: async () => undefined,
    generate: async () => undefined,
    speak: () => {},
    logger: silentLogger,
    sampleIntervalMs: () => undefined,
  });
  assert.equal(companion.state().sampleIntervalMs, 30_000);
});

test('state() while disabled clears the baseline so reopening starts fresh', async () => {
  let enabled = true;
  const hashes = [BLACK, WHITE];
  const companion = createCompanion({
    enabled: () => enabled,
    probe: async () => hashes.shift() ?? BLACK,
    capture: async () => 'data:image/jpeg;base64,AAAA',
    generate: async () => '好',
    speak: () => {},
    logger: silentLogger,
  });
  await companion.tick(); // 基线
  enabled = false;
  companion.state(); // 关掉时查一次状态 → 基线清掉
  enabled = true;
  await companion.tick(); // 这一拍只是新基线，不该触发
  assert.equal(companion.state().triggers, 0);
});

test('normalizeSay: SILENT variants, first line, quotes and truncation', () => {
  assert.equal(normalizeSay('SILENT'), undefined);
  assert.equal(normalizeSay('silent。'), undefined);
  assert.equal(normalizeSay('**SILENT**'), undefined);
  assert.equal(normalizeSay('SILENT 这场没什么可说的'), undefined);
  assert.equal(normalizeSay('「血不多了，往后撤」'), '血不多了，往后撤');
  assert.equal(normalizeSay('左边有人\n右边也有'), '左边有人');
  assert.equal(normalizeSay('   \n\n'), undefined);
  // 超长截断到 40 字
  const long = normalizeSay('一'.repeat(100)) ?? '';
  assert.equal([...long].length, 40);
});

test('generateCompanion returns provider-missing without a model and sends the image otherwise', async () => {
  const none = await generateCompanion(
    { agentDefaultModel: { currentSelection: () => ({ provider: '', model: '' }) } },
    'sys',
    'data:x',
  );
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'provider-missing');

  // 伪 llm：记录 options，回一个文本块
  const seen: unknown[] = [];
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'standalone', model: 'test-model' }) },
    llm: {
      // 与 dsh-llm 的流契约一致：yield 形如 { type: 'text', text } 的块
      async *stream(options: unknown) {
        seen.push(options);
        yield { type: 'text', text: '右边有人绕后了' };
      },
    },
  };
  const hit = await generateCompanion(ctx, 'sys', 'data:image/jpeg;base64,AAAA');
  assert.equal(hit.ok, true);
  assert.equal(hit.ok && hit.text, '右边有人绕后了');
  const opts = seen[0] as { messages: Array<{ content: Array<{ type: string }> }> };
  const blocks = opts.messages[0].content;
  assert.equal(blocks[0].type, 'text');
  assert.equal(blocks[1].type, 'image_url');
  assert.equal(blocks[2].type, 'text');
});

test('say() bypasses change detection and cooldown but respects the switch', async () => {
  const spoken: string[] = [];
  let enabled = true;
  const companion = createCompanion({
    enabled: () => enabled,
    probe: async () => BLACK, // 画面永远不变 → tick 永远不会触发
    capture: async () => 'data:image/jpeg;base64,AAAA',
    generate: async () => '前面有人',
    speak: (text) => spoken.push(text),
    logger: silentLogger,
  });
  // 开关关着：直接拒绝，连抓图都不做
  enabled = false;
  assert.equal(await companion.say(), false);
  assert.equal(spoken.length, 0);
  // 打开后：不需要「画面变化」也能说
  enabled = true;
  assert.equal(await companion.say(), true);
  assert.deepEqual(spoken, ['前面有人']);
  // 立刻再来一次也不受冷却限制（手动触发就是要立刻响应）
  assert.equal(await companion.say(), true);
  assert.equal(spoken.length, 2);
});

test('say() reports false when the model stays silent or capture fails', async () => {
  const companion = createCompanion({
    enabled: () => true,
    probe: async () => BLACK,
    capture: async () => undefined,
    generate: async () => '不该被调用',
    speak: () => assert.fail('不该开口'),
    logger: silentLogger,
  });
  assert.equal(await companion.say(), false);

  const quiet = createCompanion({
    enabled: () => true,
    probe: async () => BLACK,
    capture: async () => 'data:image/jpeg;base64,AAAA',
    generate: async () => undefined,
    speak: () => assert.fail('不该开口'),
    logger: silentLogger,
  });
  assert.equal(await quiet.say(), false);
  assert.equal(quiet.state().silent, 1);
});
