#!/usr/bin/env python3
"""IndexTTS 本地服务（桌宠可选语音引擎的服务端）。

桌宠只认这一条契约（见 src/host/local-tts.ts）：
    POST /say  {"text": "...", "lang": "zh", "speed": 1.0}  ->  audio/wav
    GET  /health                                            ->  {"ok": true, ...}

这个文件是**薄包装**：把 IndexTTS 的 Python API 暴露成一个 HTTP 端点，
其余什么都不做（不做前端、不做队列、不做鉴权——它只监听 127.0.0.1）。

────────────────────────────────────────────────────────────────────
装法（和官方 README 一致，Windows 上注意两条）
────────────────────────────────────────────────────────────────────
  git clone https://github.com/index-tts/index-tts.git && cd index-tts
  pip install -U uv
  uv sync --all-extras --default-index "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"
      # Windows 上 DeepSpeed 基本装不上：把 pyproject.toml 里 deepspeed 那两处注释掉，
      # 或去掉 --all-extras 只装必要项。CUDA Toolkit 需要 12.8+。
  uv sync --extra webui          # 只为拿到 fastapi/uvicorn；也可单独 pip install
  uv tool install modelscope
  modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir checkpoints

准备一段 5–15 秒的参考音频（想让它像谁就录谁，注意声音授权），然后：

  set INDEXTTS_REPO=E:\\AI\\index-tts
  set INDEXTTS_VOICE=E:\\AI\\voices\\pet.wav
  uv run --project %INDEXTTS_REPO% python tools/tts-local/server.py

第一次请求会加载模型（30–60 秒，6GB 左右显存），之后常驻。
不想占显存就关掉这个进程——桌宠会自动退回系统语音，不会没声音。
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
from pathlib import Path

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import FileResponse
    from pydantic import BaseModel
    from starlette.background import BackgroundTask
except ImportError:  # pragma: no cover - 只影响启动，不影响桌宠
    print("缺少 fastapi/pydantic/uvicorn：在 IndexTTS 的 venv 里 pip install fastapi uvicorn", file=sys.stderr)
    raise

REPO = Path(os.environ.get("INDEXTTS_REPO", r"E:\AI\index-tts")).resolve()
MODEL_DIR = Path(os.environ.get("INDEXTTS_MODEL_DIR", str(REPO / "checkpoints"))).resolve()
CFG_PATH = Path(os.environ.get("INDEXTTS_CFG", str(MODEL_DIR / "config.yaml"))).resolve()
VOICE = Path(os.environ.get("INDEXTTS_VOICE", "")).resolve() if os.environ.get("INDEXTTS_VOICE") else None
USE_BF16 = os.environ.get("INDEXTTS_BF16", "1") == "1"
HOST = os.environ.get("TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TTS_PORT", "7861"))

app = FastAPI(title="dsh-pet local tts", docs_url=None, redoc_url=None)

_model = None
_model_lock = threading.Lock()   # 单卡单实例：请求串行化，避免并发把显存打爆
_infer_lock = threading.Lock()


class SayRequest(BaseModel):
    text: str
    lang: str = "zh"
    speed: float = 1.0


def load_model():
    """首次请求才加载：不点「试听」、没说话的时候，这个进程不占显存。"""
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        if not REPO.is_dir():
            raise RuntimeError(f"INDEXTTS_REPO 不存在：{REPO}")
        if VOICE is None or not VOICE.is_file():
            raise RuntimeError("INDEXTTS_VOICE 必须指向一段参考音频（wav）")
        sys.path.insert(0, str(REPO))
        started = time.time()
        try:
            from indextts.infer_v2_5 import IndexTTS2  # type: ignore
        except ImportError as error:  # pragma: no cover
            raise RuntimeError(f"导入 IndexTTS2 失败（{error}）；先按 README 装好依赖") from error
        _model = IndexTTS2(cfg_path=str(CFG_PATH), model_dir=str(MODEL_DIR), use_bf16=USE_BF16)
        print(f"[local-tts] model loaded in {time.time() - started:.1f}s", flush=True)
        return _model


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "indextts",
        "loaded": _model is not None,
        "model_dir": str(MODEL_DIR),
        "voice": VOICE.name if VOICE else None,
    }


@app.post("/say")
def say(request: SayRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    if len(text) > 300:
        raise HTTPException(status_code=400, detail="text too long")
    # 桌宠的 rate 是「语速倍率」，IndexTTS 的 duration_factor 是「时长倍率」，互为倒数
    speed = min(2.0, max(0.5, float(request.speed or 1.0)))
    duration_factor = 1.0 / speed
    started = time.time()
    handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    handle.close()
    out_path = Path(handle.name)
    try:
        model = load_model()
        with _infer_lock:
            model.infer(
                spk_audio_prompt=str(VOICE),
                text=text,
                lang="ZH" if request.lang.lower().startswith("zh") else request.lang.upper(),
                output_path=str(out_path),
                duration_factor=duration_factor,
                verbose=False,
            )
        if not out_path.is_file() or out_path.stat().st_size == 0:
            raise HTTPException(status_code=502, detail="model produced no audio")
        # 只记字数、字节与耗时，不把桌宠说的话写进日志
        print(
            f"[local-tts] say {len(text)} chars -> {out_path.stat().st_size}B "
            f"in {(time.time() - started) * 1000:.0f}ms",
            flush=True,
        )
        return FileResponse(
            path=str(out_path),
            media_type="audio/wav",
            headers={"cache-control": "no-store"},
            background=BackgroundTask(lambda: out_path.unlink(missing_ok=True)),
        )
    except HTTPException:
        out_path.unlink(missing_ok=True)
        raise
    except Exception as error:  # pragma: no cover - 模型侧异常统一成 502
        out_path.unlink(missing_ok=True)
        print(f"[local-tts] infer failed: {error}", flush=True)
        raise HTTPException(status_code=502, detail=str(error)) from error


if __name__ == "__main__":
    # 只监听本机：这东西没有鉴权，绝不能暴露到局域网
    import uvicorn

    print(f"[local-tts] listening on http://{HOST}:{PORT}  (POST /say, GET /health)", flush=True)
    print(f"[local-tts] repo={REPO} model={MODEL_DIR} voice={VOICE}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
