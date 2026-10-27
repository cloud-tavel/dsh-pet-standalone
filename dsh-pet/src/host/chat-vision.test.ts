/**
 * 「看见屏幕」接入对话生成（generateChat）的测试 —— 钉住三件事：
 *  - 截图块只出现在**当前这条** user 消息上（历史永远是纯文本）；
 *  - vision.take() 失败 / 返回 undefined → 纯文本请求，行为与功能不存在完全一致；
 *  - 截屏在整个候选链上只发生一次（多候选回落不重复抓帧）。
 *
 * 用假 ctx.llm.stream + 假 vision 驱动（不碰真服务商、不联网），手法与 model-fallback.test.ts 同源。
 *
 * 跑法：node --experimental-strip-types --test src/host/chat-vision.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateChat, type ChatVision } from './chat.ts';

const CURRENT = { provider: 'current', model: 'main-model' };
const CONFIGURED = { provider: 'configured', model: 'cheap-model' };
const SHOT = 'data:image/jpeg;base64,' + 'A'.repeat(32);

interface Call {
  provider: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
}

/** 假 ctx：记录每次 llm.stream 的 messages；按 provider 决定正常/失败 */
function fakeCtx(behavior: Record<string, 'ok' | 'throw'>) {
  const calls: Call[] = [];
  const ctx = {
    agentDefaultModel: { currentSelection: (): { provider: string; model: string } => CURRENT },
    llm: {
      resolveModelInfo: async () => ({}),
      stream: (o: { provider: string; model: string; messages: unknown[] }) => {
        calls.push({
          provider: o.provider,
          model: o.model,
          messages: o.messages as Call['messages'],
        });
        const b = behavior[o.provider] ?? 'ok';
        return (async function* () {
          if (b === 'throw') throw new Error(o.provider + ' 不可用');
          yield { type: 'text-delta', index: 0, text: '你好呀' };
        })();
      },
    },
  };
  return { ctx, calls };
}

/** 假 vision：可编程（返回截图 / undefined / 抛错），并记录 take 次数 */
function fakeVision(result: string | undefined | 'throw') {
  let takes = 0;
  const vision: ChatVision & { takes(): number } = {
    takes: () => takes,
    async take() {
      takes += 1;
      if (result === 'throw') throw new Error('capture exploded');
      return result;
    },
  };
  return { vision, takeCount: () => takes };
}

describe('generateChat × 看见屏幕', () => {
  test('截图块只附在当前 user 消息上；历史与 system 不受影响', async () => {
    const { ctx, calls } = fakeCtx({ current: 'ok' });
    const { vision, takeCount } = fakeVision(SHOT);
    const r = await generateChat(
      ctx,
      '人设',
      [{ role: 'user', content: '上一句', ts: 1 }],
      '我在干嘛',
      [],
      undefined,
      vision,
    );
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.equal(takeCount(), 1);
    assert.equal(calls.length, 1);
    const messages = calls[0].messages;
    assert.equal(messages.length, 2);
    // 历史 user 消息：纯文本块（source 是消息工厂的元数据，不参与断言）
    assert.equal(messages[0].role, 'user');
    assert.deepEqual(messages[0].content, [{ type: 'text', text: '上一句' }]);
    // 当前 user 消息：正文 + 截图 + 使用说明
    const blocks = messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[0].text, '我在干嘛');
    assert.equal(blocks[1].type, 'image_url');
    assert.equal(blocks[1].image_url?.url, SHOT);
    assert.equal(blocks[2].type, 'text');
    assert.match(blocks[2].text ?? '', /截图/);
    assert.match(blocks[2].text ?? '', /不要复述/);
  });

  test('vision 缺省 / take 返回 undefined / take 抛错 → 与功能不存在逐字一致（纯文本）', async () => {
    for (const vision of [undefined, fakeVision(undefined).vision, fakeVision('throw').vision]) {
      const { ctx, calls } = fakeCtx({ current: 'ok' });
      const r = await generateChat(ctx, '人设', [], '我在干嘛', [], undefined, vision);
      assert.deepEqual(r, { ok: true, text: '你好呀' });
      assert.equal(calls.length, 1);
      const messages = calls[0].messages;
      assert.equal(messages.length, 1);
      const content = messages[0].content as Array<{ type: string; text?: string }>;
      assert.equal(content.length, 1);
      assert.equal(content[0].type, 'text');
      assert.equal(content[0].text, '我在干嘛');
    }
  });

  test('候选链回落时截屏只发生一次（不重复抓帧），截图随重试一起下发', async () => {
    const { ctx, calls } = fakeCtx({ configured: 'throw', current: 'ok' });
    const { vision, takeCount } = fakeVision(SHOT);
    const r = await generateChat(ctx, '人设', [], '我在干嘛', [], CONFIGURED, vision);
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.equal(takeCount(), 1, '多候选重试不得重复截屏');
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const last = call.messages[call.messages.length - 1].content as Array<{ type: string }>;
      assert.equal(
        last.some((b) => b.type === 'image_url'),
        true,
      );
    }
  });
});
