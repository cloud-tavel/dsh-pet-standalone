import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { StandaloneAiSettings } from './ai-config';

export type AiFetch = typeof globalThis.fetch;
/** user 消息里的一个内容块：文本或图片（data URL，见 ./vision.ts 的截屏）。 */
export type AiContentBlock = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
/** 消息内容：纯文本（绝大多数请求）或块数组（带图的那条 user 消息）。 */
export type AiContent = string | AiContentBlock[];
export interface AiTextMessage {
  role: 'user' | 'assistant';
  content: AiContent;
}
export interface AiRequest {
  system: string;
  messages: AiTextMessage[];
}
export type AiTransportEvent = { text?: string; refusal?: boolean };
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** SDKs can inherit custom auth headers from env even with explicit keys; rebuild headers. */
export function isolatedFetch(settings: Readonly<StandaloneAiSettings>, fetcher: AiFetch): AiFetch {
  const base = settings.baseUrl.replace(/\/+$/, '');
  const expected = base + (settings.protocol === 'anthropic' ? '/v1/messages' : '/chat/completions');
  return async (url, init) => {
    const beta =
      settings.protocol === 'anthropic' &&
      new URL(base).origin === 'https://api.anthropic.com' &&
      settings.model === 'claude-opus-5-5';
    const urlStr = String(url);
    const validOpenAi =
      settings.protocol === 'openai-compatible' &&
      (urlStr === expected || urlStr === base + '/chat/completions' || urlStr === base + '/v1/chat/completions');
    const validAnthropic =
      settings.protocol === 'anthropic' &&
      (urlStr === expected + (beta ? '?beta=true' : '') ||
        urlStr === base + '/messages' ||
        urlStr === base + '/v1/messages' + (beta ? '?beta=true' : ''));
    if (!validOpenAi && !validAnthropic) throw new Error('Unexpected standalone AI endpoint.');
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    if (settings.protocol === 'anthropic') {
      headers.set('x-api-key', settings.apiKey);
      headers.set('anthropic-version', '2023-06-01');
      if (new URL(base).origin === 'https://api.anthropic.com' && settings.model === 'claude-opus-5-5') {
        headers.set('anthropic-beta', 'server-side-fallback-2026-07-01');
      }
    } else headers.set('authorization', `Bearer ${settings.apiKey}`);
    return fetcher(url, { method: 'POST', body: init?.body, headers, signal: init?.signal, redirect: 'error' });
  };
}

export async function* sdkTextStream(
  settings: Readonly<StandaloneAiSettings>,
  request: AiRequest,
  signal: AbortSignal,
  fetcher: AiFetch,
): AsyncIterable<AiTransportEvent> {
  const shared = {
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl.replace(/\/+$/, ''),
    maxRetries: 0,
    timeout: settings.timeoutMs,
    fetch: isolatedFetch(settings, fetcher),
    logger: quiet,
    logLevel: 'off' as const,
  };
  if (settings.protocol === 'openai-compatible') {
    const client = new OpenAI({ ...shared, organization: null, project: null, webhookSecret: null });
    // 带图消息的块数组形状与 OpenAI Chat Completions 完全一致（text / image_url），
    // 原样透传即可；纯文本消息保持字符串 content（与旧行为逐字一致，利于上游缓存命中）。
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...request.messages.map((message) =>
        typeof message.content === 'string'
          ? ({ role: message.role, content: message.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam)
          : ({
              role: message.role,
              content: message.content,
            } as OpenAI.Chat.Completions.ChatCompletionMessageParam),
      ),
    ];
    const stream = await client.chat.completions.create(
      { model: settings.model, messages, stream: true, max_tokens: settings.maxTokens, n: 1 },
      { signal },
    );
    for await (const event of stream) {
      const delta = event.choices.find((choice) => choice.index === 0)?.delta;
      if (delta?.refusal) yield { refusal: true };
      if (delta?.content) yield { text: delta.content };
    }
    return;
  }
  // Explicit authToken:null prevents SDK environment/OAuth/profile credential resolution.
  const client = new Anthropic({ ...shared, authToken: null, webhookKey: null });
  const opus = settings.model === 'claude-opus-5-5';
  const firstParty = new URL(settings.baseUrl).origin === 'https://api.anthropic.com';
  // Anthropic 协议不收图片块：带图消息已在 provider 层被显式拒绝（openai-compatible only），
  // 这里做的是形状收口——块数组按纯文本拼接（防御性，正常到不了这里）。
  const toAnthropicContent = (content: AiContent): string => {
    if (typeof content === 'string') return content;
    return content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
  };
  const parameters = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system: request.system,
    messages: request.messages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: toAnthropicContent(message.content),
    })),
    stream: true as const,
    ...(opus ? { thinking: { type: 'adaptive' as const }, output_config: { effort: 'low' as const } } : {}),
  };
  const stream =
    opus && firstParty
      ? await client.beta.messages.create(
          { ...parameters, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal },
        )
      : await client.messages.create(parameters, { signal });
  for await (const event of stream) {
    if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') yield { refusal: true };
    // Only delta text: never re-emit accumulated content or thinking/progress blocks.
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { text: event.delta.text };
  }
}

export function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  );
}
export function isRateLimitFailure(error: unknown): boolean {
  return error instanceof OpenAI.RateLimitError || error instanceof Anthropic.RateLimitError;
}
