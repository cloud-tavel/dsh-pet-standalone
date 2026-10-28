/**
 * 语音播报（TTS）：把桌宠说的话用语音念出来。两套引擎，同一入口。
 *
 * 引擎一：系统语音（默认）
 *  - 浏览器自带 `speechSynthesis`，直接用 Windows 的 SAPI 音色，**不联网、不花钱、无延迟**；
 *    走云端 TTS 要额外密钥与费用，对一个「偶尔说一句」的功能完全没必要。
 *
 * 引擎二：本地 TTS 服务（可选，见 tools/tts-local/）
 *  - 向宿主 `GET /voice/say` 要一段音频（宿主再去调 127.0.0.1 上的 IndexTTS 之类）。
 *    音质高一个量级，代价是显存与**秒级延迟**——所以它只在用户明确打开时才用。
 *  - 服务没起 / 超时 / 返回垃圾 → 自动退回系统语音，绝不静默变哑巴（见 `speakLocal`）。
 *  - 端点由宿主保管，这一层只认 `engine` 字段，不碰地址（客户端不该知道服务在哪）。
 *
 * 为什么放在渲染端而不是主进程：
 *  - 桌宠说话本来就是渲染端触发（triggerWhisper），语音挂同一处最不容易出现
 *    「有气泡没声音 / 有声音没气泡」的错位。
 *  - 播放也要渲染端做（Audio 元素），两套引擎的收口在一处。
 *
 * 已知限制：
 *  - Chromium 要求**用户激活**（点过页面）之后才允许出声；没点过会被拒绝
 *    （not-allowed / play() 抛 NotAllowedError）。这里不弹窗打扰，只记状态。
 *  - 音色列表在不同机器上差别很大，所以 `voice` 存的是名字，取不到就退回「第一个中文音色」。
 *
 * 开关与参数来自宿主写的 `sections.voice`（见 host/index.ts 的 writeSay），默认关闭。
 */

export interface VoiceSettings {
  enabled: boolean;
  /** 语速倍率（0.5–2）；本地引擎时作为 `speed` 交给服务端 */
  rate: number;
  /** 音量（0–1） */
  volume: number;
  /** 音色名（speechSynthesis 的 voice.name；空 = 自动挑中文）→ 仅系统引擎用 */
  voice: string;
  /** 'system' = 系统语音合成；'local' = 本地 TTS 服务 */
  engine: 'system' | 'local';
}

const DEFAULT_VOICE: VoiceSettings = { enabled: false, rate: 1, volume: 1, voice: '', engine: 'system' };

/** 本地合成的等待上限：宿主侧 20 秒超时，这里再宽一点，把「宿主也没响应」兜住 */
const LOCAL_SAY_TIMEOUT_MS = 25_000;

/** 宿主路由前缀（与 host/index.ts 的 ROUTE_PREFIX 一致；客户端只发这一个相对地址） */
const SAY_URL = '/dsh-pet-7340/voice/say';

let current: VoiceSettings = DEFAULT_VOICE;
let supported: boolean | undefined;
let lastError: string | undefined;
let blocked = false;
/** 正在播的本地音频（新的一句要能打断旧的，与系统语音的 cancel 语义一致） */
let audioEl: HTMLAudioElement | undefined;
/** 播报序号：异步拿音频期间又来了一句新的，就把旧结果丢掉，不去播过期的声音 */
let playSeq = 0;
/** 诊断：上一次实际用的是哪条路（local / system / fallback）与本地合成耗时 */
let lastEngineUsed: 'local' | 'system' | 'fallback' | undefined;
let lastLocalMs: number | undefined;

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
    // 未知值一律当系统引擎：宁可机械音，也不要因为一个错字段变成不出声
    engine: record.engine === 'local' ? 'local' : 'system',
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
 * 念不出来也不该影响气泡显示）。同步返回，内部按引擎决定走哪条路。
 */
export function speakText(text: string): void {
  if (!current.enabled) return;
  const clean = text.trim();
  if (!clean) return;
  // 纯符号/表情不念（念出来是一串噪音或直接空白）
  if (!/[\p{L}\p{N}]/u.test(clean)) return;
  if (current.engine === 'local') {
    void speakLocal(clean);
    return;
  }
  speakSystem(clean);
}

/** 系统语音（原来的唯一路径）。`via` 只影响诊断字段：是被选中的，还是本地失败后兜的底 */
function speakSystem(text: string, via: 'system' | 'fallback' = 'system'): void {
  const s = synth();
  if (!s) return;
  lastEngineUsed = via;
  stopAudio();
  try {
    // 同一时刻只念一句：新的盖掉旧的，避免连环触发时几句话叠在一起
    s.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
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

/**
 * 本地引擎：先向宿主要音频，拿到再播；任何一步失败都退回系统语音。
 * 全程不抛异常（调用方不 await），失败只记 `lastError`。
 */
async function speakLocal(text: string): Promise<void> {
  const seq = ++playSeq;
  stopAudio(); // 新的先打断旧的
  let dataUrl: string | undefined;
  let tookMs = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOCAL_SAY_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${SAY_URL}?text=${encodeURIComponent(text)}&speed=${encodeURIComponent(String(current.rate))}`,
        { cache: 'no-store', signal: controller.signal },
      );
      const body = (await response.json()) as { ok?: unknown; audio?: unknown; reason?: unknown; ms?: unknown };
      if (body && body.ok === true && typeof body.audio === 'string' && body.audio.length > 0) {
        dataUrl = body.audio;
        tookMs = typeof body.ms === 'number' ? body.ms : 0;
      } else {
        lastError = 'local:' + String(body?.reason ?? 'http-' + response.status);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    lastError = 'local:' + (error instanceof Error ? error.message : String(error));
  }

  // 拿音频的这几秒里又来了一句新的：这段声音已经过期，不再播
  if (seq !== playSeq) return;
  if (!dataUrl) {
    speakSystem(text, 'fallback');
    return;
  }
  if (!(await playAudio(dataUrl))) {
    if (seq !== playSeq) return;
    speakSystem(text, 'fallback');
    return;
  }
  lastEngineUsed = 'local';
  lastLocalMs = tookMs;
}

/** 播 data URL 音频；不支持 / 被自动播放策略拦下都返回 false（由调用方决定回退） */
async function playAudio(url: string): Promise<boolean> {
  if (typeof Audio === 'undefined') {
    lastError = 'audio-unsupported';
    return false;
  }
  try {
    stopAudio();
    const audio = new Audio(url);
    audio.volume = current.volume;
    audioEl = audio;
    await audio.play();
    return true;
  } catch (error) {
    lastError = 'play:' + (error instanceof Error ? error.message : String(error));
    return false;
  }
}

function stopAudio(): void {
  if (!audioEl) return;
  try {
    audioEl.pause();
  } catch {
    /* 暂停失败无所谓：最多是把上一句念完 */
  }
  audioEl = undefined;
}

export function stopSpeech(): void {
  // 让排队中的本地合成结果作废（否则关掉开关后几秒，声音才姗姗来迟地响起来）
  playSeq += 1;
  stopAudio();
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
  } catch {
    /* 取消失败无所谓：最多是把上一句念完 */
  }
}

/** 诊断用：语音是否可用、是否被浏览器拦过、最后一次错误、最近走了哪条引擎 */
export function speechState(): {
  supported: boolean;
  blocked: boolean;
  lastError: string | undefined;
  engine: 'system' | 'local';
  lastEngineUsed: 'local' | 'system' | 'fallback' | undefined;
  lastLocalMs: number | undefined;
} {
  synth();
  return {
    supported: supported === true,
    blocked,
    lastError,
    engine: current.engine,
    lastEngineUsed,
    lastLocalMs,
  };
}
