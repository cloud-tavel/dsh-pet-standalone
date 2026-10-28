/**
 * 本地 TTS 服务客户端（可选语音引擎，契约见 SCREEN-VISION.md 第 10.7 节）。
 *
 * 为什么是「外部服务」而不是内置模型：IndexTTS-2.5 推理要约 6GB 显存，桌宠本体是
 * Electron + Node，塞不进去也不该塞。做成外部服务后，桌宠只在「要说话」那一刻发一个
 * 短 POST 拿回音频；服务没起 / 太慢 / 返回垃圾，一律降级回系统语音（client/tts.ts）。
 *
 * 契约（桌宠不关心对面是谁，能返回音频就行）：
 *   POST {endpoint}/say
 *   { "text": "要念的字", "lang": "zh", "speed": 1.1 }
 *    → 200 + Content-Type: audio/*（wav / mp3 / ogg 都行，直接给字节）
 *    → 或 200 + JSON { "audio_base64": "...", "content_type": "audio/wav" }
 *   失败用非 2xx，或 200 + `{ok:false}`（两种情况这里都当失败）。
 *
 * 这一层只做「发出去 + 收回来 + 判个真假」，不碰配置、不碰状态、不落盘——
 * 所以它可以在单测里用一个假 fetcher 完整跑一遍，不需要真的起 Python。
 */

/** 单句最长字符数：再长就是模型一次说了整段，既不礼貌也会把延迟拉到没法接受 */
export const LOCAL_TTS_MAX_TEXT = 300;

/** 一次合成的上限等待：4060 Laptop 实测一句 8 秒的话约 3–5 秒，冷启动更久 */
export const LOCAL_TTS_DEFAULT_TIMEOUT_MS = 20_000;

/** 音频体积上限：超过这个数不可能是「一句话」，按服务异常处理 */
export const LOCAL_TTS_MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface LocalTtsOptions {
  /** 服务根地址，例如 http://127.0.0.1:7861（结尾斜杠会被吃掉） */
  endpoint: string;
  /** 要念的文本（调用方负责长度；超长这里直接拒，不去截断——截断会把半句话念出来） */
  text: string;
  /** 语速倍率，交给服务端处理（IndexTTS 侧换算成 duration_factor） */
  speed?: number;
  timeoutMs?: number;
  /** 测试注入点；默认用全局 fetch */
  fetcher?: typeof fetch;
}

export type LocalTtsResult =
  { ok: true; audio: Buffer; contentType: string; ms: number } | { ok: false; reason: LocalTtsFailureReason };

/** 失败原因是给设置页文案与日志用的枚举，不是给用户看的原始错误 */
export type LocalTtsFailureReason =
  | 'empty-text'
  | 'text-too-long'
  | 'bad-endpoint'
  | 'timeout'
  | 'network'
  | 'empty-audio'
  | 'too-large'
  | 'not-audio'
  | `http-${number}`;

/**
 * 端点校验：只接受「干净的 http(s) 地址」。
 * 拒绝带账号、查询串、片段的写法——它们要么是配置写错了（把路径当端点），
 * 要么会让拼接 `{endpoint}/say` 得到一个谁也没法复现的 URL。
 */
export function isLocalTtsEndpoint(value: string): boolean {
  if (!value) return false;
  if (value !== value.trim() || /[\s\\]/.test(value)) return false;
  if (value.includes('?') || value.includes('#')) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

function normalizeContentType(raw: string): string {
  const value = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (value.startsWith('audio/')) return value;
  if (value === 'application/ogg') return 'audio/ogg';
  return value;
}

/** 从 `data:audio/wav;base64,...` 或裸 base64 里取出字节；取不出返回 undefined */
function decodeBase64Audio(value: string): Buffer | undefined {
  const cleaned = value.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!cleaned) return undefined;
  try {
    const buf = Buffer.from(cleaned, 'base64');
    return buf.length > 0 ? buf : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 让本地服务念一句。**任何失败都返回 `{ok:false}`**，绝不抛异常——
 * 语音永远不是主链路，调用方只需要「成功就播，失败就换系统语音」。
 */
export async function synthesizeLocalTts(options: LocalTtsOptions): Promise<LocalTtsResult> {
  const text = options.text.trim();
  if (!text) return { ok: false, reason: 'empty-text' };
  if (text.length > LOCAL_TTS_MAX_TEXT) return { ok: false, reason: 'text-too-long' };
  if (!isLocalTtsEndpoint(options.endpoint)) return { ok: false, reason: 'bad-endpoint' };

  const endpoint = options.endpoint.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : LOCAL_TTS_DEFAULT_TIMEOUT_MS;
  const speed = typeof options.speed === 'number' && Number.isFinite(options.speed) ? options.speed : 1;

  const controller = new AbortController();
  const startedAt = Date.now();
  const TIMED_OUT = Symbol('timed-out');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt = fetcher(`${endpoint}/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/*,application/json' },
      body: JSON.stringify({ text, lang: 'zh', speed }),
      signal: controller.signal,
    });
    // 竞速里输掉的那一边（超时已判、请求后到）不能再变成「未处理的 rejection」
    attempt.catch(() => {});

    // 超时**不依赖 fetch 是否尊重 abort**：自己起一个计时器参与竞速。
    // （真实 fetch 会因 abort 抛错，但注入的 fetcher、某些 polyfill 不一定。）
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, timeoutMs);
    });
    const first = await Promise.race([attempt, timedOut]);
    if (first === TIMED_OUT) return { ok: false, reason: 'timeout' };

    const response = first;
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };

    // 先看声明长度：超限直接放弃，不把几十 MB 读进内存
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > LOCAL_TTS_MAX_AUDIO_BYTES) {
      return { ok: false, reason: 'too-large' };
    }

    const contentType = normalizeContentType(response.headers.get('content-type') ?? '');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) return { ok: false, reason: 'empty-audio' };
    if (body.length > LOCAL_TTS_MAX_AUDIO_BYTES) return { ok: false, reason: 'too-large' };

    if (contentType.startsWith('audio/')) {
      return { ok: true, audio: body, contentType, ms: Date.now() - startedAt };
    }

    // 兼容把音频塞进 JSON 的实现（部分网关/自建中间层这么干）
    if (contentType.includes('json') || contentType === 'text/plain') {
      let parsed: { audio_base64?: unknown; audio?: unknown; content_type?: unknown; ok?: unknown } | undefined;
      try {
        parsed = JSON.parse(body.toString('utf8')) as typeof parsed;
      } catch {
        return { ok: false, reason: 'not-audio' };
      }
      if (parsed?.ok === false) return { ok: false, reason: 'not-audio' };
      const encoded =
        typeof parsed?.audio_base64 === 'string'
          ? parsed.audio_base64
          : typeof parsed?.audio === 'string'
            ? parsed.audio
            : '';
      const audio = encoded ? decodeBase64Audio(encoded) : undefined;
      if (!audio) return { ok: false, reason: 'not-audio' };
      if (audio.length > LOCAL_TTS_MAX_AUDIO_BYTES) return { ok: false, reason: 'too-large' };
      const declaredType = typeof parsed?.content_type === 'string' ? normalizeContentType(parsed.content_type) : '';
      return {
        ok: true,
        audio,
        contentType: declaredType.startsWith('audio/') ? declaredType : 'audio/wav',
        ms: Date.now() - startedAt,
      };
    }

    return { ok: false, reason: 'not-audio' };
  } catch {
    // AbortController 触发时 fetch 抛 AbortError；两者都归成两类原因，不把原始堆栈往外抛
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
