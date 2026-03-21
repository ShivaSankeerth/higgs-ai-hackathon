import json
import base64
from backend._types import Message, MessageContent, InputAudio

def get_emotion_template(emotion: str, gender: str):
    with open("backend/data/emotion_templates.json", "r") as f:
        templates = json.load(f)

    items = templates[emotion][gender]
    messages = []
    for item in items:
        filename, transcript = item["file_name"], item["transcript"]
        path = f"backend/data/emotion_template_files/{filename}.wav"
        with open(path, "rb") as f:
            data = f.read()
        data_str = base64.b64encode(data).decode("utf-8")
        messages.extend([
            Message(role="user", content=f"[SPEAKER] {transcript}"),
            Message(
                role="assistant",
                content=[MessageContent(
                    type="input_audio",
                    input_audio=InputAudio(data=data_str, format="wav")
                )]
            )
        ])
    return messages


def memory_to_string(memory: list[Message]):
    memory_str = ""
    for item in memory:
        memory_str += f"{item.role.upper()} : {item.content}\n"
    return memory_str
