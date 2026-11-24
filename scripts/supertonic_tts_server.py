#!/usr/bin/env python3
"""Lightweight loopback HTTP TTS server powered by Supertonic 3 (ONNX, native Indonesian).

Endpoints:
  GET  /health -> {"ok": true, "model": "supertonic-3", "voices": [...]}
  POST /tts    -> JSON {"text", "voice", "lang", "speed", "steps"} -> audio/wav (24kHz mono PCM16)

Security:
  - Binds to 127.0.0.1 by default (loopback only).
  - Enforces Bearer token auth via LOCAL_TTS_API_KEY when set (constant-time comparison).
"""

from __future__ import annotations

import hmac
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
import supertonic

HOST = os.environ.get("LOCAL_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_TTS_PORT", "8091"))
MODEL_NAME = os.environ.get("LOCAL_TTS_MODEL", "supertonic-3")
MODEL_DIR = os.environ.get("LOCAL_TTS_MODEL_DIR", "/data/supertonic-tts/models")
DEFAULT_VOICE = os.environ.get("LOCAL_TTS_VOICE", "M3")
API_KEY = os.environ.get("LOCAL_TTS_API_KEY", "").strip()
TARGET_SR = 24000
MAX_TEXT_CHARS = 600

print(f"[supertonic-tts] Loading {MODEL_NAME} from {MODEL_DIR}...", flush=True)
t_load = time.time()
TTS_ENGINE = supertonic.TTS(
    model=MODEL_NAME,
    model_dir=MODEL_DIR,
    auto_download=True,
)
VOICE_STYLES = {name: TTS_ENGINE.get_voice_style(name) for name in TTS_ENGINE.voice_style_names}
SUPPORTED_LANGS = set(supertonic.SUPPORTED_LANGUAGES)
INFER_LOCK = threading.Lock()
print(
    f"[supertonic-tts] Ready in {time.time() - t_load:.2f}s "
    f"(sr={TTS_ENGINE.sample_rate}, voices={list(VOICE_STYLES.keys())})",
    flush=True,
)


def resample_to_target(arr: np.ndarray, from_sr: int, to_sr: int) -> np.ndarray:
    if from_sr == to_sr or len(arr) == 0:
        return arr.astype(np.float32, copy=False)
    n_out = max(1, int(round(len(arr) * to_sr / from_sr)))
    x_old = np.linspace(0.0, 1.0, len(arr), endpoint=False)
    x_new = np.linspace(0.0, 1.0, n_out, endpoint=False)
    return np.interp(x_new, x_old, arr).astype(np.float32)


class TtsHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[supertonic-tts] {self.address_string()} {fmt % args}", flush=True)

    def _send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _check_auth(self) -> bool:
        if not API_KEY:
            return True
        auth = self.headers.get("Authorization", "")
        expected = f"Bearer {API_KEY}"
        return hmac.compare_digest(auth.encode("utf-8"), expected.encode("utf-8"))

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "model": MODEL_NAME,
                    "voices": list(VOICE_STYLES.keys()),
                    "default_voice": DEFAULT_VOICE,
                },
            )
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/tts":
            self._send_json(404, {"error": "not_found"})
            return
        if not self._check_auth():
            self._send_json(401, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 16384:
                self._send_json(400, {"error": "invalid_content_length"})
                return
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        text = str(body.get("text", "")).strip()
        if len(text) < 2 or len(text) > MAX_TEXT_CHARS:
            self._send_json(400, {"error": "invalid_text_length"})
            return

        voice = str(body.get("voice") or DEFAULT_VOICE).strip()
        if voice not in VOICE_STYLES:
            voice = DEFAULT_VOICE if DEFAULT_VOICE in VOICE_STYLES else next(iter(VOICE_STYLES))

        lang = str(body.get("lang") or "id").strip().lower()
        if lang not in SUPPORTED_LANGS:
            lang = "id"

        try:
            speed = float(body.get("speed", 1.03))
        except Exception:
            speed = 1.03
        speed = min(1.35, max(0.75, speed))

        try:
            steps = int(body.get("steps", 8))
        except Exception:
            steps = 8
        steps = min(16, max(4, steps))

        t0 = time.time()
        try:
            with INFER_LOCK:
                wav, _ = TTS_ENGINE.synthesize(
                    text,
                    voice_style=VOICE_STYLES[voice],
                    lang=lang,
                    total_steps=steps,
                    speed=speed,
                )
            arr = np.asarray(wav, dtype=np.float32).squeeze()
            arr = resample_to_target(arr, TTS_ENGINE.sample_rate, TARGET_SR)
            buf = io.BytesIO()
            sf.write(buf, arr, TARGET_SR, format="WAV", subtype="PCM_16")
            wav_bytes = buf.getvalue()
        except Exception as exc:
            self._send_json(500, {"error": f"synthesis_failed: {exc}"})
            return

        elapsed_ms = int((time.time() - t0) * 1000)
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.send_header("X-TTS-Model", MODEL_NAME)
        self.send_header("X-TTS-Voice", voice)
        self.send_header("X-TTS-Latency-Ms", str(elapsed_ms))
        self.end_headers()
        self.wfile.write(wav_bytes)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), TtsHandler)
    print(f"[supertonic-tts] Listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
