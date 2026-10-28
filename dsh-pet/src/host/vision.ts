/**
 * 「看见屏幕」：对话时附带当前屏幕截图（可选能力）。
 *
 * 设计继承 proto-screen 的实测结论（见 dsh-pet-standalone/SCREEN-VISION.md）：
 *  - **只在这几个时刻截屏**：对话弹窗打开（预取）、对话提交时缓存失效（兜底）。
 *    不做定时截屏、不做连续抓帧——「看 ≠ 盯」。
 *  - **截图不落盘**：JPEG 只活在函数作用域与 30 秒内存缓存里，本模块没有任何
 *    fs 调用（grep 可证）。原始画面只随对话请求发往用户自己配置的模型服务商。
 *  - **30 秒缓存**：连续对话不重复截屏（实测二次预取 0ms / 0 元）。
 *  - 失败一律降级为「纯文本对话」：截屏失败、被禁用、超时都只影响这一条消息，
 *    绝不抛错打断对话主链路。
 *
 * Electron 依赖（desktopCapturer）不在本模块：桌面 Helper 是唯一的 Electron 进程，
 * 截屏经 helper 的 capture RPC 完成（`HelperProcess.requestCapture`，见 helper-process.ts）。
 * 本模块保持纯逻辑、capture 注入，可脱离 Electron 单测（与 ai-provider 注入 fetch 同一手法）。
 */
import type { LoggerLike } from './log-file';

/** 截屏函数的形状：返回 data URL（image/jpeg;base64,...），失败/不可用返回 undefined。 */
export type ScreenCapture = (signal?: AbortSignal) => Promise<string | undefined>;

/** 缓存有效期：30 秒内的画面视为「同一画面」（与 proto-screen 实测口径一致）。 */
export const VISION_TTL_MS = 30_000;
/** 两次实际截屏的最小间隔：防连点对话弹窗时反复抓帧。 */
export const VISION_MIN_INTERVAL_MS = 1_500;

export interface StandaloneVision {
  /**
   * 预取：后台截一张进缓存（fire-and-forget）。对话弹窗打开时调用，
   * 等用户打完字按下回车，画面已经在缓存里（省掉 ~700ms 现场截屏）。
   */
  prefetch(): void;
  /**
   * 取一张可用的屏幕画面：缓存新鲜 → 0 开销命中；否则现场截一张。
   * 禁用 / 失败 / 超时返回 undefined（调用方降级纯文本），不抛错。
   */
  take(signal?: AbortSignal): Promise<string | undefined>;
  /** 清缓存（关机 / 关开关时调用：不该留一张旧画面在内存里）。 */
  clear(): void;
  /** 供 /vision/state 诊断用：只含尺寸与计数，绝不含画面内容。 */
  state(): {
    fresh: boolean;
    ageMs: number | undefined;
    bytes: number | undefined;
    captures: number;
    cacheHits: number;
    failures: number;
  };
}

export interface VisionOptions {
  /** 真正的截屏实现（helper capture RPC；测试注入假实现）。 */
  capture: ScreenCapture;
  /** 开关（独立模式 AI 设置的 visionEnabled；DSH 宿主恒 false）。 */
  enabled: () => boolean;
  logger?: Pick<LoggerLike, 'info' | 'warn' | 'debug'>;
  now?: () => number;
  ttlMs?: number;
  minIntervalMs?: number;
  /** 单次截屏超时（ms）：超过即视为失败，返回 undefined，不让对话干等。 */
  captureTimeoutMs?: number;
}

export function createVision(options: VisionOptions): StandaloneVision {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? VISION_TTL_MS;
  const minIntervalMs = options.minIntervalMs ?? VISION_MIN_INTERVAL_MS;
  const captureTimeoutMs = options.captureTimeoutMs ?? 3_000;
  let cached: { url: string; at: number; bytes: number } | undefined;
  let inflight: Promise<string | undefined> | undefined;
  let lastCaptureAt = 0;
  let captures = 0;
  let cacheHits = 0;
  let failures = 0;

  const runCapture = (): Promise<string | undefined> => {
    captures += 1;
    const started = now();
    // 竞速超时：helper 卡住时不让对话陪着等（capture RPC 自身也有超时，这里是双保险）。
    // 计时器不 unref——靠「竞速落定即清」收口：先完成则清掉计时器不拖进程退出，
    // 挂死则计时器正常触发解锁调用方（unref 会在空事件循环里根本不触发，等于没设）。
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), captureTimeoutMs);
    });
    const attempt = Promise.resolve()
      .then(() => options.capture())
      .catch((error: unknown) => {
        options.logger?.debug?.(
          `[dsh-pet] 截屏失败（对话降级纯文本）：${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      });
    return Promise.race([attempt, timeout]).then((url) => {
      if (timer !== undefined) clearTimeout(timer);
      const elapsed = now() - started;
      if (url === undefined || url.length === 0) {
        failures += 1;
        options.logger?.debug?.(`[dsh-pet] 截屏未返回画面（${elapsed}ms）`);
        return undefined;
      }
      const bytes = url.length;
      cached = { url, at: now(), bytes };
      lastCaptureAt = now();
      // 只记尺寸与耗时：画面内容（哪怕截到什么敏感东西）不进日志。
      // 用 info 而非 debug：文件日志默认过滤 debug，而「这一刻截了多大一张图、花了多久」
      // 是排查「它为什么说看不到」的唯一线索（图片内容本身永远不落日志）。
      options.logger?.info?.(`[dsh-pet] 截屏完成 ${bytes} chars，${elapsed}ms`);
      return url;
    });
  };

  const captureOnce = (): Promise<string | undefined> => {
    if (inflight) return inflight;
    inflight = runCapture().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };

  /**
   * 开关检查 + 「关了就清」：开关被关掉的瞬间，缓存里不该再留一张屏幕画面
   * （与 SCREEN-VISION.md「关闭即彻底」口径一致——不依赖调用方记得调 clear()）。
   */
  const ensureEnabled = (): boolean => {
    if (options.enabled()) return true;
    cached = undefined;
    inflight = undefined;
    return false;
  };

  return {
    prefetch(): void {
      if (!ensureEnabled()) return;
      if (cached !== undefined && now() - cached.at < ttlMs) return;
      void captureOnce();
    },
    async take(signal?: AbortSignal): Promise<string | undefined> {
      if (!ensureEnabled()) return undefined;
      if (signal?.aborted) return undefined;
      if (cached !== undefined && now() - cached.at < ttlMs) {
        cacheHits += 1;
        return cached.url;
      }
      // 刚截过不久但已过期：退回旧画面会答错「现在」，重新抓帧又变成连点场景反复抓屏。
      // 折中：间隔内直接放弃（本条消息纯文本），下一条消息自然可以再截。
      if (now() - lastCaptureAt < minIntervalMs && cached !== undefined) return undefined;
      return captureOnce();
    },
    clear(): void {
      cached = undefined;
      inflight = undefined;
      lastCaptureAt = 0;
    },
    state() {
      // 诊断也是「一次访问」：先走开关检查，关闭状态下查询就把缓存丢掉。
      // 否则 /vision/state 会在开关关掉后继续报 fresh:true（缓存里那张图其实还在），
      // 既误导排查，也和「关了就清」的口径冲突。
      ensureEnabled();
      const ageMs = cached !== undefined ? now() - cached.at : undefined;
      return {
        fresh: ageMs !== undefined && ageMs < ttlMs,
        ageMs,
        bytes: cached?.bytes,
        captures,
        cacheHits,
        failures,
      };
    },
  };
}
