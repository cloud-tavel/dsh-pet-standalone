/** Local-only settings shell; external same-origin assets keep CSP free of unsafe-inline. */
export const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠 AI 设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body>
<main><header><span class="fish" aria-hidden="true">🐾</span><p class="local">独立桌宠 / 本机设置</p>
<h1>桌宠 AI 设置</h1><p class="intro">配置你的大模型 API 接口，开启桌面聊天与碎碎念。<br>所有设置仅保存在本机，支持即时测试连接。</p></header>
<form id="settings" aria-describedby="privacy">
<fieldset><legend>模型连接</legend>
<label for="protocol">接口协议</label><select id="protocol" name="protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select>
<label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="hint" id="endpoint-note">填写服务商提供的基础接口地址（支持 HTTP 与 HTTPS，通常以 /v1 结尾）。不要把密钥放进地址。</p>
<label for="model">模型名称</label><input id="model" name="model" type="text" maxlength="200" placeholder="填写服务商的模型 ID，例如 deepseek-chat" spellcheck="false">
<div class="key-heading"><label for="apiKey">API 密钥</label><span id="key-state" class="hint">尚未读取</span></div>
<input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note">
<p id="key-note" class="hint">密钥只写入本机配置，不会回显。留空不会删除旧密钥。</p>
<label class="check clear"><input id="clearApiKey" type="checkbox">清除已保存的密钥，并关闭 AI</label>
<label class="check enabled"><input id="enabled" type="checkbox">启用 AI 对话</label>
<div class="test-row"><button id="test-btn" type="button">测试连接</button><span id="test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>定时自动碎碎念</legend>
<label class="check"><input id="automaticWhispers" type="checkbox" aria-describedby="cost">开启自动碎碎念</label>
<p id="cost" class="notice">开启后，桌宠会按设定间隔定时调用模型并在桌面上说话冒泡（产生 API 费用）。默认关闭；右键菜单中的手动对话与手动碎碎念不受此开关限制。</p>
<div class="pair"><div><label for="whisperIntervalSec">碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="60" max="86400" step="1" value="300" required></div>
<div><label for="maxTokens">单次输出上限（tokens）</label><input id="maxTokens" type="number" min="128" max="4096" step="1" value="1024" required></div></div>
<p class="hint">间隔至少 60 秒，默认 300 秒。输出上限越小，单次回复越简短。</p>
</fieldset>
<fieldset><legend>看见屏幕（实验）</legend>
<label class="check"><input id="visionEnabled" type="checkbox" aria-describedby="vision-note">对话时让桌宠看一眼当前屏幕</label>
<p id="vision-note" class="notice">开启后，每次「对话」会把当前画面的截图（约半分辨率 JPEG，不落盘、不进对话记忆）与你的消息一起发送给你配置的模型服务商，用于理解画面；碎碎念不带图。需要支持视觉的模型（如 deepseek-flash），且仅限 OpenAI 兼容协议。默认关闭。</p>
<label for="visionTarget">截屏范围</label>
<select id="visionTarget"><option value="foreground">只截前台窗口（推荐）</option><option value="screen">整屏</option></select>
<p class="hint">「只截前台窗口」只保留你正在用的那个窗口那块区域，桌面、别的窗口、任务栏都不在画面里；整屏会把它们一起带上。前台窗口不在主显示器上、或当时没有可用窗口时，这一次就不截（不会退回整屏）。</p>
</fieldset>
<fieldset><legend>陪玩解说（观战）</legend>
<label class="check"><input id="companionEnabled" type="checkbox" aria-describedby="companion-note">打游戏时，让桌宠在旁边看着主动说一句</label>
<p id="companion-note" class="notice">开启后，桌宠会<b>每隔一段时间</b>取一次屏幕的极简指纹（64×36 缩略图，仅在桌宠进程内算成 16 位哈希，画面本身不外发）来判断画面有没有大变化；只有判定为「换了场面」时才会截全图并发给你配置的模型，让它说一句。90 秒内最多说一次，模型认为没什么可说时会保持沉默。<b>这会持续采样屏幕，默认关闭。</b></p>
<div class="pair"><div><label for="companionIntervalSec">采样间隔（秒）</label><input id="companionIntervalSec" type="number" min="10" max="600" step="1" value="30" required></div>
<div><label for="ttsVoice">音色</label><select id="ttsVoice"><option value="">自动（优先中文）</option></select></div></div>
<p class="hint">间隔至少 10 秒，默认 30 秒。<b>实测每次采样约 0.6–0.8 秒</b>（系统截屏的固定开销，与图大小无关；第一次采样会多花约 1 秒做准备），也就是说间隔越小，游戏里每隔这么久就会有一次约 1 秒的抓屏——想要更灵敏就调小，怕影响帧数就调大或关掉。</p>
<label class="check"><input id="ttsEnabled" type="checkbox" aria-describedby="tts-note">语音播报（桌宠说话时念出来）</label>
<p id="tts-note" class="hint">默认用系统自带语音合成，在本机播放，不联网、不额外花钱。第一次可能需要在本页点一下任意位置以解锁浏览器音频权限。</p>
<div class="pair"><div><label for="ttsRate">语速（0.5–2）</label><input id="ttsRate" type="number" min="0.5" max="2" step="0.1" value="1" required></div>
<div><label for="ttsVolume">音量（0–1）</label><input id="ttsVolume" type="number" min="0" max="1" step="0.1" value="1" required></div></div>
<label for="ttsEngine">语音引擎</label>
<select id="ttsEngine" aria-describedby="tts-engine-note"><option value="system">系统语音合成（默认，零依赖）</option><option value="local">本地 TTS 服务（IndexTTS 等，音质好）</option></select>
<p id="tts-engine-note" class="hint">「本地服务」会把下面那个地址当成一个自建 TTS 服务：桌宠每说一句就发一次请求拿音频再播。它要占显存、延迟是秒级，<b>建议只在玩不吃性能的小游戏时打开</b>；服务没起、太慢或返回异常都会自动退回系统语音，不会变成哑巴。搭法见项目里的 <code>tools/tts-local/</code>（带一个不用显卡的 mock 服务，可以先拿它验证链路）。</p>
<label for="ttsEndpoint">本地服务地址</label>
<input id="ttsEndpoint" type="url" maxlength="2048" placeholder="http://127.0.0.1:7861" spellcheck="false" aria-describedby="tts-endpoint-note">
<p id="tts-endpoint-note" class="hint">只填根地址，不要带 /say 或查询参数。<b>试听用的是已保存的设置</b>，改完先点保存再试听。</p>
<div class="test-row"><button id="tts-test-btn" type="button">试听一句</button><span id="tts-test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<footer><p id="privacy">所有配置与密钥仅保存在当前机器。<br>关闭 AI 后，桌宠仍可正常显示、移动与互动。</p><button id="save" type="submit" disabled>保存到本机</button></footer>
<p id="status" role="status" aria-live="polite">正在读取本机设置…</p>
</form><noscript>需要启用 JavaScript 才能保存设置。请从桌宠菜单打开本页。</noscript></main></body></html>`;

export const settingsStyle = `
:root{color-scheme:light;--ink:#203b4b;--muted:#526a78;--blue:#12618b;--line:#cbdce5;--paper:#fff;--water:#edf5fa}
*{box-sizing:border-box}body{margin:0;background:var(--water);color:var(--ink);font:16px/1.6 "Microsoft YaHei UI","PingFang SC",sans-serif}
main{max-width:720px;margin:48px auto;padding:0 24px 32px}header{padding:0 12px 28px}.fish{display:block;font:700 29px/1.3 Georgia,serif;color:var(--blue);letter-spacing:2px;margin-bottom:24px}.local{font-size:13px;color:var(--muted);margin:0 0 10px}h1{font-size:32px;line-height:1.3;letter-spacing:-1px;margin:0 0 16px;font-weight:700}.intro{margin:0;color:var(--muted)}
form{background:var(--paper);border:1px solid var(--line);border-radius:16px 16px 6px 6px;padding:28px 32px 20px}fieldset{padding:0 0 28px;margin:0 0 24px;border:0;border-bottom:1px solid var(--line);min-width:0}legend{font-size:19px;font-weight:700;margin-bottom:18px;padding:0}label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input:not([type=checkbox]),select{display:block;width:100%;min-height:44px;border:1px solid #a5bdcb;border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;font:inherit;font-size:15px}input::placeholder{color:#6a7e8b}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}.check{display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer}.enabled{margin-top:24px}.clear{font-weight:400;color:var(--muted);font-size:13px}.hint{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.key-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.key-heading label{margin:0 0 6px}.key-heading .hint{margin:0 0 6px}.notice{font-size:13px;color:#704b13;background:#fff7e7;border-left:3px solid #c18e36;margin:12px 0 16px;padding:12px 14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}footer{display:flex;align-items:center;justify-content:space-between;gap:18px}footer p{font-size:12px;color:var(--muted);margin:0}button{border:0;border-radius:7px;min-height:44px;padding:10px 20px;background:var(--blue);color:#fff;font:600 15px/1.5 inherit;white-space:nowrap;cursor:pointer}button:hover{background:#0b4e73}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #3a94c4;outline-offset:3px}#status{font-size:13px;min-height:24px;margin:18px 0 0;color:var(--blue)}#status[data-error=true]{color:#a13b30}
.test-row{display:flex;align-items:center;gap:14px;margin:20px 0 6px;flex-wrap:wrap}#test-btn{background:#fff;color:var(--blue);border:1.5px solid var(--blue);min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}#test-btn:hover{background:#edf5fa}#test-btn:disabled{opacity:.6;cursor:wait}.test-result{font-size:13px;line-height:1.5;min-height:22px;flex:1 1 200px}.test-success{color:#1a7f37;font-weight:600}.test-error{color:#cf222e}.reply-preview{display:block;color:var(--muted);font-weight:normal;font-size:12px;margin-top:4px;word-break:break-all}
@media(max-width:560px){main{margin:24px auto;padding:0 14px 24px}header{padding:0 8px 24px}h1{font-size:28px}form{padding:24px 20px 16px}.pair{grid-template-columns:1fr;gap:0}footer{align-items:stretch;flex-direction:column}button{width:100%}.fish{margin-bottom:18px}}
`;

export const settingsScript = `
'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const get = id => document.getElementById(id);
  const form = get('settings');
  const status = get('status');
  const save = get('save');
  const testBtn = get('test-btn');
  const testResult = get('test-result');
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  async function request(method, body) {
    const response = await fetch('/standalone-ai/settings', {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
      if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
      throw new Error('设置未保存。请检查接口地址、模型名称与密钥，再重试。');
    }
    return response.json();
  }
  function populate(data) {
    for (const id of ['protocol','baseUrl','model','whisperIntervalSec','maxTokens','companionIntervalSec','ttsRate','ttsVolume','visionTarget','ttsEngine','ttsEndpoint']) {
      if (data[id] !== undefined) get(id).value = String(data[id]);
    }
    for (const id of ['enabled','automaticWhispers','visionEnabled','companionEnabled','ttsEnabled']) get(id).checked = data[id] === true;
    // 音色：列表可能是异步填充的（getVoices 首次常为空），所以先把值记下来，填完列表再选上
    pendingVoice = typeof data.ttsVoice === 'string' ? data.ttsVoice : '';
    applyVoiceSelection();
    get('key-state').textContent = data.hasKey ? '已保存 · 不回显' : '尚未设置';
    get('apiKey').value = '';
    get('clearApiKey').checked = false;
  }
  // ---- 音色列表：系统语音合成器能给出本机可用的声音（含中文） ----
  // 用 typeof 探测而不是直接读 window：本脚本在测试里会跑在没有 window 的沙箱中，
  // 裸读 window.speechSynthesis 会直接抛 ReferenceError（已踩过）。
  const speech = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  let pendingVoice = '';
  function applyVoiceSelection() {
    const select = get('ttsVoice');
    if (!select) return;
    // options 可能不存在（极简 DOM 替身）：拿不到就跳过，别让「选音色」把整页保存流程带崩
    const options = select.options ? Array.from(select.options) : [];
    const want = pendingVoice || '';
    const hit = options.some(option => option.value === want);
    select.value = hit ? want : '';
  }
  function loadVoices() {
    const select = get('ttsVoice');
    if (!select || !speech) return;
    const voices = speech.getVoices() || [];
    if (voices.length === 0) return;
    // 中文优先排前面（桌宠说中文，选个英文音色会念得很怪）
    const sorted = voices.slice().sort((a, b) => {
      const zh = v => (String(v.lang || '').toLowerCase().startsWith('zh') ? 0 : 1);
      return zh(a) - zh(b) || String(a.name).localeCompare(String(b.name));
    });
    const keep = select.value || pendingVoice;
    select.length = 1; // 保留「自动」那一项
    for (const voice of sorted) {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = voice.name + '（' + (voice.lang || '未知语言') + '）';
      select.appendChild(option);
    }
    pendingVoice = keep;
    applyVoiceSelection();
  }
  if (speech) {
    loadVoices();
    speech.addEventListener('voiceschanged', loadVoices);
  }
  get('clearApiKey').addEventListener('change', () => {
    get('apiKey').disabled = get('clearApiKey').checked;
    if (get('clearApiKey').checked) {
      get('apiKey').value = '';
      get('enabled').checked = false;
      get('automaticWhispers').checked = false;
    }
  });
  if (testBtn && testResult) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testResult.className = 'test-result';
      testResult.textContent = '正在测试连接，请稍候…';
      const input = {
        protocol: get('protocol').value,
        baseUrl: get('baseUrl').value.trim(),
        model: get('model').value.trim(),
        apiKey: get('apiKey').value.trim(),
      };
      try {
        const response = await fetch('/standalone-ai/test', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            'X-DSH-Pet-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (data.ok) {
          testResult.className = 'test-result test-success';
          testResult.textContent = '✓ ' + data.message;
          if (data.reply) {
            const preview = document.createElement('span');
            preview.className = 'reply-preview';
            preview.textContent = '回复: ' + data.reply;
            testResult.appendChild(preview);
          }
        } else {
          testResult.className = 'test-result test-error';
          testResult.textContent = '✗ ' + (data.message || data.error || '测试失败');
        }
      } catch (error) {
        testResult.className = 'test-result test-error';
        testResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
      } finally {
        testBtn.disabled = false;
      }
    });
  }
  // ---- 试听本地语音：让「本地服务到底通没通」在设置页就能验证，不必进游戏等它开口 ----
  // 走宿主 GET /voice/say（只读、不改状态），因此不需要页面凭据；用的是**已保存**的设置。
  const ttsTestBtn = get('tts-test-btn');
  const ttsTestResult = get('tts-test-result');
  const ttsReasons = {
    disabled: '语音播报没开：勾上「语音播报」并保存',
    'engine-system': '引擎还是「系统语音」：切到「本地 TTS 服务」并保存',
    'bad-endpoint': '服务地址为空或不合法',
    timeout: '服务 20 秒内没响应（模型可能还在加载）',
    network: '连不上服务，确认它已经在跑',
    'not-audio': '服务返回的不是音频',
    'empty-audio': '服务返回了空音频',
    'too-large': '返回的音频太大，可能是配置错了地址',
    'text-too-long': '这句话太长',
  };
  const ttsReasonText = reason => ttsReasons[reason] || '失败：' + reason;
  if (ttsTestBtn && ttsTestResult) {
    ttsTestBtn.addEventListener('click', async () => {
      ttsTestBtn.disabled = true;
      ttsTestResult.className = 'test-result';
      ttsTestResult.textContent = '正在合成…（本地模型可能要几秒）';
      try {
        const text = '试听：这是一句本地语音合成，听到就说明服务通了。';
        const speed = Number(get('ttsRate').value) || 1;
        const response = await fetch('/dsh-pet-7340/voice/say?text=' + encodeURIComponent(text) + '&speed=' + encodeURIComponent(String(speed)), { cache: 'no-store' });
        const data = await response.json();
        if (!data.ok) {
          ttsTestResult.className = 'test-result test-error';
          ttsTestResult.textContent = '✗ ' + ttsReasonText(String(data.reason));
          return;
        }
        if (typeof Audio === 'undefined') {
          ttsTestResult.className = 'test-result test-error';
          ttsTestResult.textContent = '✗ 当前环境不支持播放音频';
          return;
        }
        const audio = new Audio(data.audio);
        audio.volume = Number(get('ttsVolume').value) || 1;
        await audio.play();
        ttsTestResult.className = 'test-result test-success';
        ttsTestResult.textContent = '✓ 已播放（合成 ' + Math.round(Number(data.ms || 0) / 100) / 10 + ' 秒）';
      } catch (error) {
        ttsTestResult.className = 'test-result test-error';
        ttsTestResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
      } finally {
        ttsTestBtn.disabled = false;
      }
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    message('正在保存到本机…');
    const input = {
      protocol: get('protocol').value, baseUrl: get('baseUrl').value.trim(), model: get('model').value.trim(),
      apiKey: get('apiKey').value, clearApiKey: get('clearApiKey').checked,
      enabled: get('enabled').checked, automaticWhispers: get('automaticWhispers').checked,
      visionEnabled: get('visionEnabled').checked,
      visionTarget: get('visionTarget').value === 'screen' ? 'screen' : 'foreground',
      companionEnabled: get('companionEnabled').checked,
      companionIntervalSec: Number(get('companionIntervalSec').value),
      ttsEnabled: get('ttsEnabled').checked,
      ttsRate: Number(get('ttsRate').value), ttsVolume: Number(get('ttsVolume').value),
      ttsVoice: get('ttsVoice').value,
      ttsEngine: get('ttsEngine').value === 'local' ? 'local' : 'system',
      ttsEndpoint: get('ttsEndpoint').value.trim(),
      whisperIntervalSec: Number(get('whisperIntervalSec').value), maxTokens: Number(get('maxTokens').value)
    };
    get('apiKey').value = '';
    try {
      populate(await request('POST', input));
      get('apiKey').disabled = false;
      message('已保存到本机。');
    } catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  });
  if (!token) { message('请从桌宠菜单或本机启动器打开设置，以获得本次运行的访问凭据。', true); return; }
  request('GET').then(data => { populate(data); save.disabled = false; message('设置只在本机保存。'); })
    .catch(error => message(error.message, true));
})();
`;
