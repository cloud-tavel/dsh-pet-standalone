#!/usr/bin/env node
/**
 * 本地 TTS 服务的「假实现」——不需要显卡、不需要 Python、不下载模型，
 * 用来验证桌宠这一侧的链路（设置页试听 / 游戏里播报 / 失败回退）。
 *
 * 契约与真服务一致：
 *   POST /say  { text, lang, speed }  →  audio/wav
 *   GET  /health                     →  { ok: true, engine: 'mock' }
 *
 * 用法：
 *   node tools/tts-local/mock-server.mjs            # 默认 127.0.0.1:7861
 *   node tools/tts-local/mock-server.mjs --port 7900
 *
 * 返回的是一段时长随文本变化的提示音（不是人声），用来确认「有声音、延迟多少」。
 */
import { createServer } from 'node:http';

const SAMPLE_RATE = 22_050;

/** 生成一个 16bit 单声道 WAV：一段带淡入淡出的正弦音，时长 = 0.35s + 每字 0.12s（上限 6s） */
function toneWav(text) {
  const chars = [...String(text ?? '')].length;
  const seconds = Math.min(6, 0.35 + chars * 0.12);
  const total = Math.round(SAMPLE_RATE * seconds);
  const data = Buffer.alloc(total * 2);
  const freq = 392; // G4，听上去不像报警
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    // 前 40ms 淡入、后 80ms 淡出，避免爆音
    const fadeIn = Math.min(1, t / 0.04);
    const fadeOut = Math.min(1, (seconds - t) / 0.08);
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    // 轻微颤音，听得出「这是一句话」而不是一声哔
    const vibrato = 1 + 0.02 * Math.sin(2 * Math.PI * 5 * t);
    const value = Math.sin(2 * Math.PI * freq * vibrato * t) * 0.25 * envelope;
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const argPort = (() => {
  const index = process.argv.indexOf('--port');
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 7861;
})();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, engine: 'mock', sampleRate: SAMPLE_RATE }));
    return;
  }

  if (url.pathname !== '/say') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, reason: 'not-found' }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, reason: 'method-not-allowed' }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, reason: 'bad-json' }));
      return;
    }
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (!text.trim()) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, reason: 'empty-text' }));
      return;
    }
    const started = Date.now();
    const wav = toneWav(text);
    // 只记字数与字节数，不记文本内容（与桌宠侧的日志口径一致）
    console.log(`[mock-tts] say ${[...text].length} chars -> ${wav.length}B in ${Date.now() - started}ms`);
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store' });
    res.end(wav);
  });
});

server.listen(argPort, '127.0.0.1', () => {
  console.log(`[mock-tts] listening on http://127.0.0.1:${argPort}  (POST /say, GET /health)`);
  console.log('[mock-tts] 在设置页把「语音引擎」切到“本地 TTS 服务”、地址填这个，然后点“试听一句”。');
});
