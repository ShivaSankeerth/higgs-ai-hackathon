import os
import openai
from dotenv import load_dotenv
from backend._types import Message

load_dotenv()

class LLM(object):

    def __init__(self, use_oai=False):
        if use_oai:
            self.client = openai.Client(api_key=os.getenv("OAI_API_KEY"))
        else:
            self.client = openai.Client(
                api_key=os.getenv("API_KEY"),
                base_url=os.getenv("BASE_URL")
            )
        self.tts_model = "higgs-audio-generation-Hackathon"
        self.asr_model = "higgs-audio-understanding-Hackathon"
        self.chat_model = "Qwen3-32B-non-thinking-Hackathon"

    def get_speech_from_text(
            self,
            instructions: str,
            text: str,
            voice: str,
            with_streaming: bool,
            response_format: str = "wav",
            speed: float = 1.0,
            chunk_size: int = 2048
    ):
        params = {
            "model": self.tts_model,
            "voice": voice,
            "input": text,
            "instructions": instructions,
            "response_format": response_format,
            "speed": speed
        }
        if not with_streaming:
            response = self.client.audio.speech.create(**params)
            yield response.content
        else:
            with self.client.audio.speech.with_streaming_response.create(**params) as response:
                for chunk in response.iter_bytes(chunk_size=chunk_size):
                    yield chunk

    def get_speech_from_chat_completion(
            self,
            messages: list[Message],
            stream=False
    ):
        response = self.client.chat.completions.create(
            messages=[m.to_dict() for m in messages],
            model=self.tts_model,
            temperature=1.0,
            modalities=["audio"],
            max_completion_tokens=1600,
            top_p=0.95,
            stream=stream,
            stop=["<|eot_id|>", "<|end_of_text|>", "<|audio_eos|>"],
            extra_body={"top_k": 50}
        )
        if not stream:
            yield response.choices[0].message.audio.data
        else:
            for chunk in response:
                delta = getattr(chunk.choices[0], "delta", None)
                audio = getattr(delta, "audio", None)
                if not audio:
                    continue
                yield audio["data"]

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
            params["max_completion_tokens"] = max_tokens
        if temperature:
            params["temperature"] = temperature
        if response_format:
            params["response_format"] = response_format
        response = self.client.chat.completions.create(**params)
        return response.choices[0].message

    def get_text_from_speech(
                self,
                messages: list[Message],
                ) -> str:
        response = self.client.chat.completions.create(
            model=self.asr_model,
            messages=[m.to_dict() for m in messages],
            max_completion_tokens=1024,
            temperature=0.4
        )
        return response.choices[0].message.content
