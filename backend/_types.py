import json
import hashlib
from dataclasses import dataclass, asdict, is_dataclass
from typing import Optional, Union, Literal

PROSPECT_MOOD = Literal[
    "neutral", "skeptical", "interested", "impatient",
    "friendly", "hostile", "confused"
]

@dataclass
class InputAudio:
    data: bytes
    format: str

@dataclass
class ImageURL:
    url: str

@dataclass
class AudioURL:
    url: str

@dataclass
class MessageContent:
    type: str
    input_audio: Optional[InputAudio] = None
    image_url: Optional[ImageURL] = None
    audio_url: Optional[AudioURL] = None
    text: Optional[str] = None

    def to_dict(self):
        base = {"type": self.type}
        if self.type == "input_audio" and self.input_audio:
            base["input_audio"] = asdict(self.input_audio)
        elif self.type == "image_url" and self.image_url:
            base["image_url"] = asdict(self.image_url)
        elif self.type == "audio_url" and self.audio_url:
            base["audio_url"] = asdict(self.audio_url)
        elif self.type == "text" and self.text:
            base["text"] = self.text
        return base

@dataclass
class Message:
    role: str
    content: Union[str, list[MessageContent]]

    def to_dict(self):
        if isinstance(self.content, list):
            content_dict = [
                c.to_dict() if isinstance(c, MessageContent)
                else (asdict(c) if is_dataclass(c) else c)
                for c in self.content
            ]
        elif is_dataclass(self.content):
            content_dict = asdict(self.content)
        else:
            content_dict = self.content
        return {"role": self.role, "content": content_dict}

@dataclass
class UserParams:
    prospect_role: str
    industry: str
    objection_type: str
    deal_stage: str
    mood: PROSPECT_MOOD
    gender: str

    def to_dict(self):
        return asdict(self)

    def generate_id(self) -> str:
        data_str = json.dumps(self.to_dict(), sort_keys=True)
        return hashlib.sha256(data_str.encode('utf-8')).hexdigest()[:12]

@dataclass
class Log:
    role: str
    timestamp: float
    audio: str
    transcription: str

    def to_dict(self):
        return asdict(self)
