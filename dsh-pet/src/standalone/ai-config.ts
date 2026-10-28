import { z } from 'zod';
import { readAiSettings, writeAiSettings } from './ai-storage';

export interface StandaloneAiPublicSettings {
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  model: string;
  enabled: boolean;
  automaticWhispers: boolean;
  whisperIntervalSec: number;
  maxTokens: number;
  timeoutMs: number;
  /**
   * 「看见屏幕」开关（对话时附带当前屏幕截图，见 ./vision.ts）。
   * 默认**关闭**——这是会向模型服务商外发画面内容的能力，必须用户显式打开
   * （SCREEN-VISION.md 第 5 节的默认值口径）。
   */
  visionEnabled: boolean;
  /**
   * 「陪玩解说」开关（观战型：低频采样画面变化，关键时刻主动说一句，见 ../host/companion.ts）。
   * 默认**关闭**——它会在你不问的时候持续采样屏幕，必须用户显式打开。
   * 依赖 visionEnabled 的同一套截屏通道，但两者互不代替：vision 是"你问才看"，这是"你不问也看"。
   */
  companionEnabled: boolean;
  /** 陪玩采样间隔（秒）：越小越灵敏、抓屏越频繁。下限 5 秒（与 companion.ts 的 MIN 对齐）。 */
  companionIntervalSec: number;
  /** 语音播报（TTS）：桌宠说话时念出来。默认关闭。 */
  ttsEnabled: boolean;
  /** 语速倍率（0.5–2，1 为正常）。 */
  ttsRate: number;
  /** 音量（0–1）。 */
  ttsVolume: number;
  /** 音色名（浏览器 speechSynthesis 的 voice.name；留空 = 自动挑中文音色）。 */
  ttsVoice: string;
  hasKey: boolean;
}
export type StandaloneAiSettings = Omit<StandaloneAiPublicSettings, 'hasKey'> & { apiKey: string };

export const DEFAULT_AI_SETTINGS: Readonly<StandaloneAiSettings> = Object.freeze({
  protocol: 'openai-compatible',
  baseUrl: '',
  model: '',
  enabled: false,
  automaticWhispers: false,
  whisperIntervalSec: 300,
  maxTokens: 1024,
  timeoutMs: 30_000,
  visionEnabled: false,
  companionEnabled: false,
  companionIntervalSec: 30,
  ttsEnabled: false,
  ttsRate: 1,
  ttsVolume: 1,
  ttsVoice: '',
  apiKey: '',
});

function safeEndpoint(value: string): boolean {
  if (!value) return true;
  if (value !== value.trim() || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) {
      return false;
    }
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function containsControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) return true;
  }
  return false;
}

const fields = {
  protocol: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().max(2048).refine(safeEndpoint),
  model: z
    .string()
    .trim()
    .max(200)
    .refine((s) => !containsControlChar(s)),
  enabled: z.boolean(),
  automaticWhispers: z.boolean(),
  whisperIntervalSec: z.number().int().min(60).max(86400),
  maxTokens: z.number().int().min(128).max(4096),
  timeoutMs: z.number().int().min(1000).max(60_000),
  visionEnabled: z.boolean(),
  companionEnabled: z.boolean(),
  companionIntervalSec: z.number().int().min(10).max(600),
  ttsEnabled: z.boolean(),
  ttsRate: z.number().min(0.5).max(2),
  ttsVolume: z.number().min(0).max(1),
  ttsVoice: z
    .string()
    .max(200)
    .refine((s) => !containsControlChar(s)),
  apiKey: z
    .string()
    .max(4096)
    .refine((s) => !containsControlChar(s) && !/\s/.test(s)),
};
const persistedSchema = z.object(fields).strict();
const patchSchema = persistedSchema.partial().extend({ clearApiKey: z.boolean().optional() }).strict();

export function validateSettings(input: unknown, previous: Readonly<StandaloneAiSettings>): StandaloneAiSettings {
  try {
    const patch = patchSchema.parse(input);
    if (patch.clearApiKey && patch.apiKey) throw new Error('Conflicting key changes');
    const { clearApiKey, ...values } = patch;
    const apiKey = clearApiKey ? '' : values.apiKey || previous.apiKey;
    const next = persistedSchema.parse({ ...previous, ...values, apiKey });
    if (next.enabled && (!next.model || !next.baseUrl || !next.apiKey)) throw new Error('Incomplete settings');
    return next;
  } catch {
    throw new Error('Invalid standalone AI settings.');
  }
}

function redact(settings: Readonly<StandaloneAiSettings>): StandaloneAiPublicSettings {
  const { apiKey, ...publicFields } = settings;
  return { ...publicFields, hasKey: apiKey.length > 0 };
}

export interface AiConfigStore {
  current(): Readonly<StandaloneAiSettings>;
  publicSettings(): StandaloneAiPublicSettings;
  save(input: unknown): Promise<StandaloneAiPublicSettings>;
}

export function createAiConfig(home: string): AiConfigStore {
  let settings: Readonly<StandaloneAiSettings> = DEFAULT_AI_SETTINGS;
  try {
    const loaded = readAiSettings(home);
    if (loaded !== undefined) {
      // 先用默认值补齐再校验：新增字段（如 visionEnabled）不能让旧配置文件在升级时
      // 被判成「无法安全加载」——用户已保存的密钥因此读不出来属于升级事故。
      settings = Object.freeze(
        validateSettings(persistedSchema.parse({ ...DEFAULT_AI_SETTINGS, ...loaded }), DEFAULT_AI_SETTINGS),
      );
    }
  } catch {
    throw new Error('Cannot securely load standalone AI settings.');
  }
  return {
    current: () => settings,
    publicSettings: () => redact(settings),
    async save(input) {
      const next = validateSettings(input, settings);
      try {
        writeAiSettings(home, next);
      } catch {
        throw new Error('Cannot securely save standalone AI settings.');
      }
      settings = Object.freeze(next);
      return redact(settings);
    },
  };
}
