from backend.llm import LLM
from backend._types import Message, MessageContent, InputAudio, Log

class AnalyzeCall(object):
    def __init__(self, call_logs: list[Log]):
        self.llm = LLM()
        self.call_logs = call_logs

    def generate_summary(self):
        with open("backend/prompts/summary_prompt.txt", "r") as f:
            user_prompt = f.read()

        system_prompt = (
            "You are an expert sales coach evaluating a sales rep's performance. "
            "You will be given a conversation between a sales rep and a prospect."
        )
        messages = [Message(role="system", content=system_prompt)]
        for i in range(len(self.call_logs)):
            if self.call_logs[i].role == "user":
                messages.extend([
                    Message(
                        role="user",
                        content=[
                            MessageContent(
                                type="input_audio",
                                input_audio=InputAudio(
                                    data=self.call_logs[i].audio,
                                    format='wav',
                                )
                            )
                        ]
                    ),
                    Message(
                        role=self.call_logs[i].role,
                        content=f"TRANSCRIPTION (me, sales rep): {self.call_logs[i].transcription}"
                    )
                ])
            else:
                messages.append(Message(
                    role="user",
                    content=f"TRANSCRIPTION (prospect): {self.call_logs[i].transcription}"
                ))

        messages.append(Message(role="user", content=user_prompt))
        return self.llm.get_text_from_speech(messages=messages)
