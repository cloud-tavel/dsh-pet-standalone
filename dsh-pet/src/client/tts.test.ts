import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVoiceSettings, setVoiceSettings, speakText, speechState, stopSpeech } from './tts.ts';

/**
 * 语音播报的引擎选择与回退。
 *
 * 这里同时扮演浏览器：给 tts.ts 装上最小的 `window.speechSynthesis`、`Audio` 与 `fetch`，
 * 用它验证「本地引擎失败一定退回系统语音」这条最关键的承诺——没有它，用户打开本地引擎
 * 但服务没起时会以为桌宠哑了。
 */

type FakeAudio = {
  src: string;
  volume: number;
  play: () => Promise<void>;
  pause: () => void;
  played: boolean;
  paused: boolean;
};

const spoken: string[] = [];
let audioInstances: FakeAudio[] = [];
let playShouldFail = false;

function installGlobals(): void {
  const speechSynthesis = {
    cancel() {},
    speak(utterance: { text: string }) {
      spoken.push(utterance.text);
    },
    getVoices: () => [{ name: 'Microsoft Huihui', lang: 'zh-CN' }],
  };
  (globalThis as Record<string, unknown>).window = { speechSynthesis };
  (globalThis as Record<string, unknown>).speechSynthesis = speechSynthesis;
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = class {
    text: string;
    lang = '';
    rate = 1;
    volume = 1;
    voice: unknown;
    onerror: unknown;
    constructor(text: string) {
      this.text = text;
    }
  };
  (globalThis as Record<string, unknown>).Audio = class implements FakeAudio {
    src: string;
    volume = 1;
    played = false;
    paused = false;
    constructor(src: string) {
      this.src = src;
      audioInstances.push(this);
    }
    async play(): Promise<void> {
      if (playShouldFail) throw new Error('NotAllowedError');
      this.played = true;
    }
    pause(): void {
      this.paused = true;
    }
  };
}

/** 等本地合成那条异步链跑完（拿音频 → 播放 → 可能有回退） */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function stubFetch(impl: () => Promise<unknown>): void {
  (globalThis as Record<string, unknown>).fetch = impl;
}

test('engine defaults to system and unknown engines fall back to system', () => {
  installGlobals();
  setVoiceSettings({ enabled: true, rate: 1, volume: 1, voice: '' });
  assert.equal(readVoiceSettings().engine, 'system');
  setVoiceSettings({ enabled: true, rate: 1, volume: 1, voice: '', engine: 'indextts' });
  assert.equal(readVoiceSettings().engine, 'system');
  setVoiceSettings({ enabled: true, engine: 'local' });
  assert.equal(readVoiceSettings().engine, 'local');
  setVoiceSettings({ enabled: false });
});

test('system engine speaks locally without touching the network', () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  let fetched = 0;
  stubFetch(async () => {
    fetched += 1;
    throw new Error('不该发请求');
  });
  setVoiceSettings({ enabled: true, engine: 'system' });
  speakText('系统语音这句');
  assert.deepEqual(spoken, ['系统语音这句']);
  assert.equal(fetched, 0);
  assert.equal(audioInstances.length, 0);
});

test('local engine plays the audio returned by the host instead of using system speech', async () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  playShouldFail = false;
  let requested = '';
  stubFetch(async () => {
    return {
      status: 200,
      json: async () => ({ ok: true, audio: 'data:audio/wav;base64,UklGRg==', ms: 3200 }),
    };
  });
  const original = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = (input: string) => {
    requested = String(input);
    return (original as (i: string) => Promise<unknown>)(input);
  };

  setVoiceSettings({ enabled: true, engine: 'local', rate: 1.2, volume: 0.5 });
  speakText('本地引擎这句');
  await settle();

  assert.match(requested, /\/dsh-pet-7340\/voice\/say\?text=/);
  assert.match(requested, /speed=1\.2/);
  assert.equal(audioInstances.length, 1);
  assert.equal(audioInstances[0]?.played, true);
  assert.equal(audioInstances[0]?.volume, 0.5);
  assert.deepEqual(spoken, [], '本地成功时不该再念一遍系统语音');
  assert.equal(speechState().lastEngineUsed, 'local');
  assert.equal(speechState().lastLocalMs, 3200);
});

test('local engine falls back to system speech when the host says no', async () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  stubFetch(async () => ({ status: 200, json: async () => ({ ok: false, reason: 'network' }) }));
  setVoiceSettings({ enabled: true, engine: 'local' });
  speakText('服务没起的时候');
  await settle();
  assert.equal(audioInstances.length, 0);
  assert.deepEqual(spoken, ['服务没起的时候']);
  assert.equal(speechState().lastEngineUsed, 'fallback');
  assert.equal(speechState().lastError, 'local:network');
});

test('local engine falls back when the request itself throws', async () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  stubFetch(async () => {
    throw new TypeError('Failed to fetch');
  });
  setVoiceSettings({ enabled: true, engine: 'local' });
  speakText('请求炸了');
  await settle();
  assert.deepEqual(spoken, ['请求炸了']);
  assert.match(String(speechState().lastError), /^local:/);
});

test('local engine falls back when autoplay is blocked', async () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  playShouldFail = true;
  stubFetch(async () => ({ status: 200, json: async () => ({ ok: true, audio: 'data:audio/wav;base64,UklGRg==' }) }));
  setVoiceSettings({ enabled: true, engine: 'local' });
  speakText('自动播放被拦');
  await settle();
  assert.deepEqual(spoken, ['自动播放被拦']);
  assert.match(String(speechState().lastError), /^play:/);
  playShouldFail = false;
});

test('a newer sentence discards the slower one still in flight', async () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  const releases: (() => void)[] = [];
  stubFetch(
    () =>
      new Promise((resolve) => {
        releases.push(() =>
          resolve({ status: 200, json: async () => ({ ok: true, audio: 'data:audio/wav;base64,UklGRg==' }) }),
        );
      }),
  );
  setVoiceSettings({ enabled: true, engine: 'local' });
  speakText('先说的这句');
  await settle();
  speakText('后说的这句');
  await settle();
  // 两句的音频都回来了，但先说的那句在 seq 校验处已经被判过期
  for (const release of releases) release();
  await settle();
  assert.equal(audioInstances.length, 1);
  assert.deepEqual(spoken, []);
});

test('turning voice off invalidates pending synthesis and stops playback', async () => {
  installGlobals();
  spoken.length = 0;
  audioInstances = [];
  const releases: (() => void)[] = [];
  stubFetch(
    () =>
      new Promise((resolve) => {
        releases.push(() =>
          resolve({ status: 200, json: async () => ({ ok: true, audio: 'data:audio/wav;base64,UklGRg==' }) }),
        );
      }),
  );
  setVoiceSettings({ enabled: true, engine: 'local' });
  speakText('这句话不该响');
  await settle();
  setVoiceSettings({ enabled: false });
  for (const release of releases) release();
  await settle();
  assert.equal(audioInstances.length, 0, '关掉之后回来的音频不该播');
  assert.deepEqual(spoken, []);
  stopSpeech();
});
