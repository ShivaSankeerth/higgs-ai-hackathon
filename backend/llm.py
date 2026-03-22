import os
import json
import logging
import httpx
import openai
from dotenv import load_dotenv
from backend._types import Message

logger = logging.getLogger(__name__)

load_dotenv()

EIGEN_BASE_URL = os.getenv("BASE_URL", "https://api-web.eigenai.com/api/v1")
EIGEN_API_KEY = os.getenv("API_KEY", "")


class LLM(object):

    def __init__(self):
        self.client = openai.Client(
            api_key=EIGEN_API_KEY,
            base_url=EIGEN_BASE_URL,
        )
        self.asr_model = "higgs_asr_3"
        self.tts_model = "higgs2p5"
        self.chat_model = "gpt-oss-120b"

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

    def get_speech_from_text(self, text: str) -> bytes:
        """Convert text to speech using higgs2p5. Returns WAV bytes."""
        url = f"{EIGEN_BASE_URL}/generate"
        headers = {"Authorization": f"Bearer {EIGEN_API_KEY}"}
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json={"model": self.tts_model, "text": text})
            if not resp.is_success:
                logger.error(f"TTS error {resp.status_code}: {resp.text}")
            resp.raise_for_status()
        return resp.content

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
