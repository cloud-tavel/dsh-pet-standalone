/**
 * 语音播报（TTS）：把桌宠说的话用系统语音合成念出来。
 *
 * 为什么放在渲染端而不是主进程：
 *  - 浏览器自带 `speechSynthesis`，直接用 Windows 的 SAPI 音色，**不联网、不花钱、无延迟**；
 *    走云端 TTS 要额外密钥与费用，对一个「偶尔说一句」的功能完全没必要。
 *  - 桌宠说话本来就是渲染端触发（triggerWhisper），语音挂同一处最不容易出现
 *    「有气泡没声音 / 有声音没气泡」的错位。
 *
 * 已知限制：
 *  - Chromium 要求**用户激活**（点过页面）之后才允许 speechSynthesis.speak；
 *    没点过会被拒绝（NotAllowedError）。这里不弹窗打扰，只记状态，等下次交互后自然恢复——
 *    桌宠桌面形态下用户基本都点过（拖动、右键菜单）。
 *  - 音色列表在不同机器上差别很大，所以 `voice` 存的是名字，取不到就退回「第一个中文音色」。
 *
 * 开关与参数来自宿主写的 `sections.voice`（见 host/index.ts），默认关闭。
 */

export interface VoiceSettings {
  enabled: boolean;
  /** 语速倍率（0.5–2） */
  rate: number;
  /** 音量（0–1） */
  volume: number;
  /** 音色名（speechSynthesis 的 voice.name；空 = 自动挑中文） */
  voice: string;
}

const DEFAULT_VOICE: VoiceSettings = { enabled: false, rate: 1, volume: 1, voice: '' };

let current: VoiceSettings = DEFAULT_VOICE;
let supported: boolean | undefined;
let lastError: string | undefined;
let blocked = false;

function synth(): SpeechSynthesis | undefined {
  if (supported === undefined) {
    supported = typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  }
  return supported ? window.speechSynthesis : undefined;
}

/** 宿主写的 sections.voice → 当前语音参数（形状非法一律按默认值，不让脏数据把语音弄哑） */
export function setVoiceSettings(input: unknown): void {
  if (input === null || typeof input !== 'object') {
    current = DEFAULT_VOICE;
    return;
  }
  const record = input as Record<string, unknown>;
  current = {
    enabled: record.enabled === true,
    // 数值只认有限值并夹到合法区间：语速 0 会让声音卡住，超大值会变成尖叫
    rate: clampNumber(record.rate, 0.5, 2, 1),
    volume: clampNumber(record.volume, 0, 1, 1),
    voice: typeof record.voice === 'string' ? record.voice : '',
  };
  // 关掉开关就立刻闭嘴：不该把正在念的那句念完
  if (!current.enabled) stopSpeech();
}

export function readVoiceSettings(): VoiceSettings {
  return { ...current };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 挑音色：按名字精确命中 → 退而求其次找中文 → 再不行交给系统默认 */
function pickVoice(want: string): SpeechSynthesisVoice | undefined {
  const s = synth();
  if (!s) return undefined;
  const voices = s.getVoices();
  if (!voices || voices.length === 0) return undefined;
  if (want) {
    const hit = voices.find((v) => v.name === want);
    if (hit) return hit;
  }
  const zh = voices.find((v) =>
    String(v.lang || '')
      .toLowerCase()
      .startsWith('zh'),
  );
  return zh ?? voices[0];
}

/**
 * 念一句。开关关闭 / 无文本 / 环境不支持时**静默返回**（语音永远不是主链路，
 * 念不出来也不该影响气泡显示）。
 */
export function speakText(text: string): void {
  const s = synth();
  if (!s || !current.enabled) return;
  const clean = text.trim();
  if (!clean) return;
  // 纯符号/表情不念（念出来是一串噪音或直接空白）
  if (!/[\p{L}\p{N}]/u.test(clean)) return;
  try {
    // 同一时刻只念一句：新的盖掉旧的，避免连环触发时几句话叠在一起
    s.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'zh-CN';
    utterance.rate = current.rate;
    utterance.volume = current.volume;
    const voice = pickVoice(current.voice);
    if (voice) utterance.voice = voice;
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      // 转成字符串再比：SpeechSynthesisErrorEvent.error 的 TS 联合里没有 not-allowed，
      // 但浏览器实际会抛它（未获用户激活），所以按运行时字符串判断。
      const code = String(event.error);
      lastError = code;
      if (code === 'not-allowed') blocked = true;
    };
    s.speak(utterance);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

export function stopSpeech(): void {
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
  } catch {
    /* 取消失败无所谓：最多是把上一句念完 */
  }
}

/** 诊断用：语音是否可用、是否被浏览器拦过、最后一次错误 */
export function speechState(): { supported: boolean; blocked: boolean; lastError: string | undefined } {
  synth();
  return { supported: supported === true, blocked, lastError };
}
