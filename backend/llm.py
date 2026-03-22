import asyncio
import base64
import io
import json
import logging
import wave

import httpx
import numpy as np
import openai
from dotenv import load_dotenv
from scipy import signal as sp_signal

import os
from backend._types import Message

logger = logging.getLogger(__name__)

load_dotenv()

# ── Eigen AI (ASR + TTS) ──────────────────────────────────────────────────────
EIGEN_BASE_URL = os.getenv("BASE_URL", "https://api-web.eigenai.com/api/v1")
EIGEN_API_KEY  = os.getenv("API_KEY", "")

# ── Boson AI (audio-in, text-out — ASR + LLM combined) ───────────────────────
BOSON_BASE_URL  = "https://hackathon.boson.ai/v1"
BOSON_API_KEY   = os.getenv("BOSONAI_API_KEY", "")
BOSON_MODEL     = "higgs-audio-understanding-v3.5-Hackathon"
BOSON_STOP      = ["<|eot_id|>", "<|endoftext|>", "<|audio_eos|>", "<|im_end|>"]
BOSON_SR        = 16_000
BOSON_MAX_CHUNK = 4 * BOSON_SR   # 64 000 samples = 4 s

# Voice names available on higgs2p5
VOICE_MAP = {"male": "Jack", "female": "Linda"}


class LLM(object):

    def __init__(self):
        # Eigen AI (sync only — ASR + TTS via HTTP/WebSocket)
        self.client = openai.Client(
            api_key=EIGEN_API_KEY,
            base_url=EIGEN_BASE_URL,
        )
        # Boson AI (async — audio understanding)
        self.boson_client = openai.AsyncClient(
            api_key=BOSON_API_KEY,
            base_url=BOSON_BASE_URL,
        )

        self.asr_model   = "higgs_asr_3"
        self.tts_model   = "higgs2p5"
        self.chat_model  = "gpt-oss-120b"
        self.boson_model = BOSON_MODEL

    # ── Eigen ASR ─────────────────────────────────────────────────────────────

    def transcribe_audio(self, audio_bytes: bytes, language: str = "en") -> str:
        """Transcribe WAV audio bytes using higgs_asr_3."""
        url = f"{EIGEN_BASE_URL}/generate"
        headers = {"Authorization": f"Bearer {EIGEN_API_KEY}"}
        files = {"file": ("audio.wav", audio_bytes, "audio/wav")}
        data = {"model": self.asr_model, "language": language, "response_format": "json"}
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(url, headers=headers, files=files, data=data)
            if not resp.is_success:
                logger.error(f"ASR error {resp.status_code}: {resp.text}")
            resp.raise_for_status()
        result = resp.json()
        return result.get("text") or result.get("transcription") or str(result)

    # ── Eigen TTS (WebSocket streaming) ──────────────────────────────────────

    async def stream_speech_from_text(self, text: str, mood: str = "neutral", gender: str = "male"):
        """Stream PCM audio from higgs2p5 via WebSocket.

        Protocol:
          1. Send auth:  {"token": API_KEY, "model": "higgs2p5"}
          2. Send text:  {"text": "...", "voice": "Jack"|"Linda"}
          3. Receive:    binary PCM frames (16-bit, 24 kHz, mono)
                         then {"type": "complete"}
        """
        import websockets

        ws_url = EIGEN_BASE_URL.replace("https://", "wss://").replace("/api/v1", "/api/v1/generate/ws")
        voice  = VOICE_MAP.get(gender.lower(), "Jack")

        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps({"token": EIGEN_API_KEY, "model": self.tts_model}))
            await ws.send(json.dumps({"text": text, "voice": voice}))
            async for msg in ws:
                if isinstance(msg, bytes) and msg:
                    yield msg
                elif isinstance(msg, str):
                    try:
                        if json.loads(msg).get("type") == "complete":
                            break
                    except Exception:
                        pass

    # ── Eigen LLM (used by AnalyzeCall) ──────────────────────────────────────

    def get_chat_completion(
            self,
            messages: list[Message],
            model: str,
            max_tokens: int | None = None,
            temperature: float | None = None,
            response_format: dict | None = None
    ):
        params = {
            "model": model,
            "messages": [m.to_dict() for m in messages]
        }
        if max_tokens:
            params["max_tokens"] = max_tokens
        if temperature is not None:
            params["temperature"] = temperature
        if response_format:
            params["response_format"] = response_format
        response = self.client.chat.completions.create(**params)
        return response.choices[0].message

    def get_text_from_speech(self, messages: list[Message], response_format: dict | None = None) -> str:
        """Generate text analysis using gpt-oss-120b (used by AnalyzeCall)."""
        params = {
            "model": self.chat_model,
            "messages": [m.to_dict() for m in messages],
            "max_tokens": 2048,
            "temperature": 0.4,
        }
        if response_format:
            params["response_format"] = response_format
        response = self.client.chat.completions.create(**params)
        return response.choices[0].message.content

    # ── Boson AI — audio → prospect response ──────────────────────────────────

    def _wav_to_boson_chunks(self, wav_bytes: bytes) -> list[str]:
        """Resample WAV to 16 kHz mono, split into ≤4 s chunks, return base64 WAV strings."""
        with wave.open(io.BytesIO(wav_bytes)) as wf:
            sr        = wf.getframerate()
            n_ch      = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            frames    = wf.readframes(wf.getnframes())

        dtype = np.int16 if sampwidth == 2 else np.int32
        scale = 32768.0  if sampwidth == 2 else 2147483648.0
        audio = np.frombuffer(frames, dtype=dtype).astype(np.float32) / scale

        if n_ch > 1:
            audio = audio.reshape(-1, n_ch).mean(axis=1)

        if sr != BOSON_SR:
            n_out = int(len(audio) * BOSON_SR / sr)
            audio = sp_signal.resample(audio, n_out).astype(np.float32)

        # Boson AI minimum: > 800 samples at 16 kHz (~50 ms); require at least 1 s
        if len(audio) < BOSON_SR:
            logger.warning(f"Audio too short after resampling ({len(audio)} samples), skipping")
            return []

        result: list[str] = []
        for start in range(0, max(1, len(audio)), BOSON_MAX_CHUNK):
            chunk = audio[start : start + BOSON_MAX_CHUNK]
            samples_i16 = np.clip(chunk * 32767, -32768, 32767).astype(np.int16)
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(BOSON_SR)
                wf.writeframes(samples_i16.tobytes())
            result.append(base64.b64encode(buf.getvalue()).decode("utf-8"))

        return result

    async def get_boson_response(self, messages: list[dict]) -> str:
        """Send pre-built multi-turn messages to HiggsAudioM3 → prospect response text.

        Messages should be: system + text history turns + current audio turn.
        Built by simulator._build_boson_messages().
        """
        n_chunks = sum(
            len(m["content"]) for m in messages
            if m["role"] == "user" and isinstance(m["content"], list)
        )
        logger.info(f"Sending to Boson AI: {len(messages)} messages, {n_chunks} audio chunk(s)")
        response = await self.boson_client.chat.completions.create(
            model=self.boson_model,
            messages=messages,
            temperature=0.7,
            top_p=0.9,
            max_tokens=512,
            stop=BOSON_STOP,
            extra_body={"skip_special_tokens": False},
        )
        text = (response.choices[0].message.content or "").strip()
        logger.info(f"Boson AI response: {text}")
        return text
