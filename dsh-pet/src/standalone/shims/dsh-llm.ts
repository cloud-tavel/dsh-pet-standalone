/**
 * `@deepseek-ai/dsh-llm` 的独立模式替身（消息工厂 / 文本块拼装 / reasoning 标识）。
 *
 * 独立模式没有模型后端。`ctx.llm` 的替身（见 ../context.ts）让**没有显式配置模型**的调用在
 * 候选链阶段就失败：`agentDefaultModel.currentSelection()` 返回的 model 为空 →
 * `model-selection.ts` 的 `currentModel()` 判定为「未配置」→ `generateWhisper` / `generateChat`
 * 直接回 `{ ok: false, reason: 'provider-missing' }`。
 *
 * **但这不是结构性保证。** 用户在配置里显式写了 `whisperModel` / `chatModel`（设置页选过模型
 * 就会写进配置）时，候选链非空，生成侧会真的走到本文件的消息构造与 `ctx.llm.stream`。
 * 所以本文件与 ctx.llm 替身的每一处形状都必须与 DSH 的真实契约一致 —— 0.3.4 的崩溃正是因为
 * `stream` 被当成"永远不走的那条路"，实现成返回 Promise 而契约要求 AsyncIterable
 * （细节见 ../context.ts 里 stream / resolveModelInfo 的注释）。
 *
 * 那为什么还要实现它们：`whisper.ts` / `chat.ts` 是**静态 import** 这四个名字的，
 * 模块图能加载是独立模式起得来的前提；同时保持它们是纯本地、零网络的实现，
 * 将来若有人给独立模式接上模型通道（例如自带 API key），这条路径可以照常工作。
 *
 * 只在独立模式构建里生效：`tsdown.config.mjs` 用 alias 把该包名指向本文件。
 */

/** 消息的最小形状（只有角色、内容与来源标记；适配器回放不在独立模式范围内） */
export interface StandaloneLlmMessage {
  role: 'user' | 'assistant';
  content: unknown;
  source: unknown;
}

/** 用户消息（`whisper.ts` / `chat.ts` 的入参形状） */
export function createUserMessage(input: { content: unknown; source: unknown }): StandaloneLlmMessage {
  return { role: 'user', content: input.content, source: input.source };
}

/** 助手消息（`chat.ts` 回放历史用） */
export function createAssistantMessage(input: { content: unknown; source: unknown }): StandaloneLlmMessage {
  return { role: 'assistant', content: input.content, source: input.source };
}

/** 文本块（`BlockAssembler.blocks()` 的元素形状） */
export interface StandaloneTextBlock {
  type: 'text';
  text: string;
}

/**
 * token 计费的最小形状（与 DSH 的 `TokenUsage` 同名字段；缓存与推理字段可选）。
 *
 * 独立模式目前不从流里读 usage（`ai-provider.ts` 的流只产文本增量），
 * 但契约里有这个 getter，形状就必须在——否则下一个"顺手读一下用量"的消费方会踩空。
 */
export interface StandaloneTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/**
 * 流终止原因（DSH 的 `FinishReason`：`switch (kind)` 且对未知值兜底）。
 *
 * `noTextReason()`（`host/llm-call.ts`）正是按这个形状做诊断：
 * `aborted` / `max-tokens` / `error`（带 `failure`）各有专用文案。
 * 本文件若不给 `finish`，那道诊断就永远只能得到「模型未返回文本」，
 * 真实的取消/超限/适配器报错全部丢失 —— 所以这不是可选的装饰。
 */
export type StandaloneFinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'aborted'; failure?: unknown }
  | { kind: 'error'; failure?: unknown };

/**
 * 流式文本拼装：只收集文本块（与调用方 `blocks().filter(b => b.type === 'text')` 的用法一致）。
 *
 * 入参放宽为 `unknown` 而不是 DSH 的 `StreamChunk`，因为它要同时吃**两种增量形状**：
 * - `{ type: 'text-delta', index, text }` —— DSH 的 `StreamChunk`，单测的假流就是这个形状；
 * - `{ type: 'text', text }` —— 独立模式 `ai-provider.ts` 的 `stream()` 产出的简化增量。
 *
 * 只认前者会让独立模式收不到正文；只认后者会让单测（以及将来任何按 DSH 契约喂流的调用方）
 * 永远得到空文本 —— 两种都认才是本类唯一正确的写法。
 *
 * 另外它**会真的被走到**：`context.ts` 在用户配置了 `whisperModel` / `chatModel`
 * （或设置了独立模式模型）时把 `ctx.llm.stream` 接到 `ai.stream`，
 * 于是碎碎念与对话都会经过这里拼装正文——"独立模式只会拿到空流"是 0.3.4 之前的旧事实。
 */
export class BlockAssembler {
  private readonly chunks: string[] = [];
  private _usage: StandaloneTokenUsage | undefined;
  private _finish: StandaloneFinishReason | undefined;

  /** 收集一个块；非文本块（工具调用等）在独立模式下被忽略 */
  push(chunk: unknown): void {
    if (chunk === null || typeof chunk !== 'object') return;
    const typed = chunk as { type?: unknown; text?: unknown; reason?: unknown; usage?: unknown };
    // 'text-delta' 是 DSH 契约，'text' 是独立模式简化流 —— 两者都要收
    if (typed.type === 'text-delta' || typed.type === 'text') {
      if (typeof typed.text === 'string') this.chunks.push(typed.text);
      return;
    }
    // 终止块与用量块：独立模式的流不产它们，但形状要接得住，
    // 否则将来把 ai.stream 换成完整实现时，诊断信息会静默丢失。
    if (typed.type === 'finish' && typed.reason !== null && typeof typed.reason === 'object') {
      this._finish = typed.reason as StandaloneFinishReason;
      return;
    }
    if (typed.type === 'usage' && typed.usage !== null && typeof typed.usage === 'object') {
      this._usage = typed.usage as StandaloneTokenUsage;
    }
  }

  /** 当前已拼装的块列表 */
  blocks(): StandaloneTextBlock[] {
    const text = this.chunks.join('');
    return text === '' ? [] : [{ type: 'text', text }];
  }

  /** 被中途打断时能安全收尾的前缀块（工具调用一律丢弃——它们没有被分派过）。 */
  interruptedBlocks(): StandaloneTextBlock[] {
    const blocks = this.blocks();
    return blocks.filter((block) => block.text.trim() !== '');
  }

  /** 用量；流里没有 usage 块时为 undefined（与 DSH 的 `get usage()` 一致）。 */
  get usage(): StandaloneTokenUsage | undefined {
    return this._usage;
  }

  /**
   * 终止原因。缺少终止块时返回 `{ kind: 'stop' }` —— 与 DSH 的
   * "`{kind:'stop'}` when the stream ended without one" 逐字对齐。
   */
  get finish(): StandaloneFinishReason {
    return this._finish ?? { kind: 'stop' };
  }

  /** 回放元数据；独立模式不保留 raw chunk 日志，恒为 undefined。 */
  get replayState(): undefined {
    return undefined;
  }

  /** 组装后的 assistant 消息（独立模式只产出文本块）。 */
  message(source: { provider: string; model: string }): StandaloneLlmMessage {
    return { role: 'assistant', content: this.blocks(), source };
  }
}

/** reasoning effort 标识工厂（DSH 侧是枚举工厂，这里保持"传什么就是什么"） */
export function ReasoningEffortId(id: string): string {
  return id;
}
