/**
 * 陪玩解说（观战型「陪玩」）：桌宠盯着你的游戏画面，**只在关键时刻**说一句。
 *
 * 与「看见屏幕」（vision.ts）的分工：
 *  - vision.ts：你**问**的时候看一眼前（对话附图，按需）。
 *  - 本模块：「你不问也看」——但只做**低频采样 + 变化检测**，绝大多数采样不产生模型调用。
 *
 * 三段式，逐段都刻意做便宜：
 *  ① 采样（每 sampleIntervalMs）：只抓 64×36 缩略图并在 **helper 里**算 dHash，
 *     宿主只收到一个 16 进制指纹——原始像素连 helper 都不出，更不进宿主内存。
 *  ② 判定（纯函数，零 IO）：指纹汉明距离 ≥ changeThreshold 视为「画面换了个场面」，
 *     且距上次开口已过 cooldownMs，才进入第 ③ 段。
 *  ③ 开口（少数采样才走到）：抓一张全图 → 模型判断「值得说吗」→ 值得才写 say + 语音。
 *     模型可以回 SILENT 表示「没什么可说的」——这时**不算一次解说**，只消耗一次请求。
 *
 * 为什么不用定时硬说：定时间隔说 = 画面没变也在花钱、也在打断你；而「变化」才是
 * 值得说的事件的近似信号（换场景/开打/死亡复活/切菜单）。
 *
 * 性能口径（对游戏）：常驻只有一个 setTimeout 链，每拍一次小图抓取（实测见
 * /companion/state 的 lastProbeMs）；**没有**连续抓帧、没有轮询游戏进程、不读游戏内存。
 * 开关关闭时连采样都不做（ensureEnabled 直接跳过）。
 */
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call';
import { supportsReasoningOff } from './llm-reasoning';
import { defaultLog } from './log-file';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection';
import type { LoggerLike } from './log-file';

/** 采样间隔默认值：30 秒。
 *  **实测**：一次指纹采样（desktopCapturer.getSources + 64×36 缩略图 + dHash）在
 *  2560×1440 / 缩放 1.25 的开发机上耗时 0.6–1.2 秒——瓶颈是 getSources 抓屏本身，
 *  与缩略图大小几乎无关（半分辨率整图同样 0.6–1.6 秒）。所以采样频率直接等于
 *  「每隔多久给游戏来一下 1 秒的抓屏」。12 秒一次在那个量级上会掉帧，默认放宽到 30 秒。 */
export const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;
/** 采样间隔下限：低于 10 秒 = 每 10 秒抓一次屏，对帧数不礼貌，代码层面也不允许。 */
export const MIN_SAMPLE_INTERVAL_MS = 10_000;
/** 两次开口的最小间隔：默认 120 秒。陪玩是偶尔一句，不是弹幕。 */
export const DEFAULT_COOLDOWN_MS = 120_000;
/** 触发阈值：64 位里有 30% 以上不同 → 认为画面换了个场面。 */
export const DEFAULT_CHANGE_THRESHOLD = 0.3;

/** 汉明距离：两个等长 16 进制指纹之间不同位的个数（长度不等按较短算，脏数据不抛错）。 */
export function hammingHex(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < len; i += 1) {
    const x = Number.parseInt(a[i] ?? '', 16) ^ Number.parseInt(b[i] ?? '', 16);
    if (Number.isNaN(x)) continue;
    // 半字节里置了几位（0..4）
    diff += ((x >> 3) & 1) + ((x >> 2) & 1) + ((x >> 1) & 1) + (x & 1);
  }
  // 长度差的部分按「每一位都不同」计入，避免短指纹天然更相似
  return diff + Math.abs(a.length - b.length) * 4;
}

/** 归一化距离（0..1）：以 64 位为分母（16 进制 16 位 = 64 bit）。 */
export function hashDistance(a: string, b: string): number {
  const bits = Math.max(a.length, b.length) * 4;
  if (bits === 0) return 0;
  return hammingHex(a, b) / bits;
}

/** 本模块对外暴露的诊断（**只含计数与耗时，绝不含画面内容**）。 */
export interface CompanionState {
  enabled: boolean;
  running: boolean;
  samples: number;
  probeFailures: number;
  triggers: number;
  spoken: number;
  silent: number;
  generateFailures: number;
  lastProbeMs: number | undefined;
  lastDistance: number | undefined;
  lastSpokenAt: number | undefined;
  sampleIntervalMs: number;
  cooldownMs: number;
  changeThreshold: number;
}

export interface CompanionOptions {
  /** 开关（独立模式的 companionEnabled；DSH 宿主恒 false）。 */
  enabled: () => boolean;
  /** 采一帧指纹（helper 的 probe RPC）；失败返回 undefined。 */
  probe: () => Promise<string | undefined>;
  /** 抓一张全图（data URL）；失败返回 undefined。 */
  capture: () => Promise<string | undefined>;
  /** 生成一句解说；返回 undefined = 模型认为不值得说（静默）。 */
  generate: (image: string) => Promise<string | undefined>;
  /** 说出去（写 S 的 pets.<id>.say，客户端弹气泡 + 语音）。 */
  speak: (text: string) => void;
  logger?: Pick<LoggerLike, 'info' | 'warn' | 'debug'>;
  now?: () => number;
  /** 采样间隔（毫秒或读取函数——设置页可改，改完下一拍即生效；返回 undefined = 用默认值） */
  sampleIntervalMs?: number | (() => number | undefined);
  cooldownMs?: number;
  changeThreshold?: number;
}

export interface Companion {
  start(): void;
  stop(): void;
  /** 跑一拍（测试与手动触发用；正常由 start() 的定时链驱动）。 */
  tick(): Promise<void>;
  /** 立刻说一句：跳过变化检测与冷却（手动触发 / 实测整条链）。返回是否真的开口。 */
  say(): Promise<boolean>;
  state(): CompanionState;
  /** 开关关掉时清掉基线指纹（下次打开重新建立基线，不拿旧画面比）。 */
  reset(): void;
}

export function createCompanion(options: CompanionOptions): Companion {
  const now = options.now ?? Date.now;
  // 采样间隔每拍现读（设置页改完立即生效），并夹到下限之上：
  // 低于 5 秒就不是「采样」而是连续抓屏了，对游戏帧数不礼貌。
  const sampleIntervalMs = (): number => {
    const raw = typeof options.sampleIntervalMs === 'function' ? options.sampleIntervalMs() : options.sampleIntervalMs;
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_SAMPLE_INTERVAL_MS;
    return Math.max(MIN_SAMPLE_INTERVAL_MS, value);
  };
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const changeThreshold = options.changeThreshold ?? DEFAULT_CHANGE_THRESHOLD;

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let prevHash: string | undefined;
  let lastSpokenAt: number | undefined;
  let busy = false;
  let samples = 0;
  let probeFailures = 0;
  let triggers = 0;
  let spoken = 0;
  let silent = 0;
  let generateFailures = 0;
  let lastProbeMs: number | undefined;
  let lastDistance: number | undefined;

  const clearBaseline = (): void => {
    prevHash = undefined;
    lastDistance = undefined;
  };

  const schedule = (): void => {
    if (!running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), sampleIntervalMs());
  };

  async function tick(): Promise<void> {
    // 上一拍还没跑完（截屏慢 / 模型慢）就跳过这一拍：**不排队**——
    // 排队会让「采样」变成「补作业」，画面早就不是当时那个了。
    if (busy) {
      schedule();
      return;
    }
    if (!options.enabled()) {
      clearBaseline();
      schedule();
      return;
    }
    busy = true;
    try {
      const started = now();
      const hash = await options.probe();
      lastProbeMs = now() - started;
      if (hash === undefined || hash.length === 0) {
        probeFailures += 1;
        schedule();
        return;
      }
      samples += 1;
      if (prevHash === undefined) {
        // 首拍只建基线：没有上一帧就谈不上「变化」
        prevHash = hash;
        schedule();
        return;
      }
      const distance = hashDistance(prevHash, hash);
      lastDistance = distance;
      prevHash = hash;
      const cooled = lastSpokenAt === undefined || now() - lastSpokenAt >= cooldownMs;
      if (distance < changeThreshold || !cooled) {
        schedule();
        return;
      }
      triggers += 1;
      options.logger?.debug?.(
        `[dsh-pet] 陪玩触发：画面变化 ${(distance * 100).toFixed(0)}%（采样间隔 ${Math.round(sampleIntervalMs() / 1000)}s）`,
      );
      const image = await options.capture();
      if (image === undefined) {
        schedule();
        return;
      }
      const text = await options.generate(image);
      if (text === undefined) {
        // 模型认为不值得说：**不推进 lastSpokenAt**——下一次真有变化时还该能开口
        silent += 1;
        schedule();
        return;
      }
      options.speak(text);
      spoken += 1;
      lastSpokenAt = now();
      options.logger?.info?.(`[dsh-pet] 陪玩解说 ${text.length} 字（画面变化 ${(distance * 100).toFixed(0)}%）`);
    } catch (error) {
      generateFailures += 1;
      options.logger?.warn?.(
        `[dsh-pet] 陪玩这一拍失败（不影响下一拍）：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      busy = false;
      schedule();
    }
  }

  /**
   * 立刻说一句（**不看变化、不管冷却**）：手动触发入口。
   * 用途：① 实测/排障时验证「抓图 → 生成 → 说」整条链；② 用户想让它现在就说一句。
   * 返回是否真的说出了口（false = 抓图失败 / 模型判定不值得说 / 开关关着）。
   */
  async function say(): Promise<boolean> {
    if (!options.enabled()) return false;
    if (busy) return false;
    busy = true;
    try {
      const image = await options.capture();
      if (image === undefined) return false;
      const text = await options.generate(image);
      if (text === undefined) {
        silent += 1;
        return false;
      }
      options.speak(text);
      spoken += 1;
      lastSpokenAt = now();
      options.logger?.info?.(`[dsh-pet] 陪玩解说（手动）${text.length} 字`);
      return true;
    } catch (error) {
      generateFailures += 1;
      options.logger?.warn?.(`[dsh-pet] 陪玩手动触发失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      busy = false;
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      schedule();
    },
    stop(): void {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    tick,
    say,
    reset: clearBaseline,
    state(): CompanionState {
      // 与 vision.state() 同口径：诊断也是一次访问，关掉开关就别再报「还在盯」的假象
      if (!options.enabled()) clearBaseline();
      return {
        enabled: options.enabled(),
        running,
        samples,
        probeFailures,
        triggers,
        spoken,
        silent,
        generateFailures,
        lastProbeMs,
        lastDistance,
        lastSpokenAt,
        sampleIntervalMs: sampleIntervalMs(),
        cooldownMs,
        changeThreshold,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 生成侧
// ---------------------------------------------------------------------------

/** 单次生成超时：解说必须快，慢了就没意义（画面早变了）。 */
const GENERATE_TIMEOUT_MS = 20_000;
/** 一句解说的字数上限（汉字）：超过就截断，气泡放不下也念不完。 */
const MAX_SAY_CHARS = 40;
/** 模型用来表示「不值得说」的哨兵词。 */
const SILENT = 'SILENT';

/**
 * 陪玩指令：明确「值得说才说」+「可以不说话」——不给「必须说点什么」的压力，
 * 否则每次画面变化都会被强行编一句，很快变成噪音。
 */
const COMPANION_INSTRUCTION =
  '你正坐在旁边看主人打游戏，只能看到这一屏画面，没有前后文。\n' +
  '如果这一屏有值得说的事（战况、敌人位置、路线提示、危险、值得夸或值得吐槽的画面），' +
  '就用 20 字以内随口说一句，像朋友在旁边看。\n' +
  '如果没什么值得说的（静止菜单、过场、读条、空房间、看不出是什么），' +
  `只回 ${SILENT} 这个词，不要写别的。\n` +
  '不要描述整个画面，不要说"我看到"、"截图中"这类话，不要解释你为什么说。';

const COMPANION_HINT = '（以上是主人当前屏幕的画面。）';

export type CompanionGenerateResult =
  | { ok: true; text: string | undefined }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/**
 * 生成一句陪玩解说。
 * @param ctx 宿主上下文（注入 agentDefaultModel / llm）
 * @param system 人设提示词（petSystemPrompt）
 * @param image data URL 截图
 * @param preferred 条目配置的模型（chatModel/whisperModel 之外的 companionModel；缺省 = 当前对话模型）
 * @returns 一句话，或 `text: undefined`（模型判断不值得说 / 只回了哨兵），或结构化失败
 */
export async function generateCompanion(
  ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  system: string,
  image: string,
  preferred?: ModelRef,
): Promise<CompanionGenerateResult> {
  const candidates = modelCandidates(ctx, preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  let last: CompanionGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateCompanionWith(ctx, llm, sel, system, image);
    if (result.ok) return result;
    last = result;
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `dsh-pet: 陪玩用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

async function generateCompanionWith(
  ctx: { llm?: unknown },
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  system: string,
  image: string,
): Promise<CompanionGenerateResult> {
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  const options = {
    provider: sel.provider,
    model: sel.model,
    sessionId: PET_CALL_IDENTITY,
    messages: [
      createUserMessage({
        content: [
          { type: 'text' as const, text: COMPANION_INSTRUCTION },
          { type: 'image_url' as const, image_url: { url: image } },
          { type: 'text' as const, text: COMPANION_HINT },
        ],
        source: { kind: 'user' },
      }),
    ],
    system,
    temperature: 1,
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  };

  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) };
  }
  const raw = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b as { text: string }).text : ''))
    .join('')
    .trim();
  if (!raw) return { ok: false, reason: 'generate-error', message: noTextReason(assembler.finish) };
  return { ok: true, text: normalizeSay(raw) };
}

/**
 * 把模型输出收成「一句人话」：
 * - 只回哨兵（或哨兵后面跟了废话）→ undefined（静默）；
 * - 多说几行 → 只取第一行非空；
 * - 超长 → 截断到 MAX_SAY_CHARS（气泡与语音都撑不住长篇）；
 * - 去掉首尾引号（模型爱给对话加引号，念出来会把引号一起念了）。
 */
export function normalizeSay(raw: string): string | undefined {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  // 哨兵判断放在最前面：模型有时写成「SILENT。」或「**SILENT**」
  const bare = firstLine.replace(/[*_`"'“”「」\s。.]/g, '').toUpperCase();
  if (bare === SILENT || bare.startsWith(SILENT)) return undefined;
  let text = firstLine.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim();
  if (!text) return undefined;
  if (text.length > MAX_SAY_CHARS) text = text.slice(0, MAX_SAY_CHARS);
  return text;
}
