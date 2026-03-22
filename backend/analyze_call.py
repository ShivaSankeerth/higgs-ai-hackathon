import json
from backend.llm import LLM
from backend._types import Message, Log


class AnalyzeCall(object):
    def __init__(self, call_logs: list[Log]):
        self.llm = LLM()
        self.call_logs = call_logs

    def generate_summary(self) -> dict:
        with open("backend/prompts/summary_prompt.txt", "r") as f:
            user_prompt = f.read()

        system_prompt = (
            "You are an expert sales coach evaluating a sales rep's performance. "
            "You will be given a conversation transcript between a sales rep and a prospect. "
            "You must respond only with valid JSON — no markdown, no prose."
        )
        messages = [Message(role="system", content=system_prompt)]
        for log in self.call_logs:
            if log.role == "user":
                messages.append(Message(role="user", content=f"SALES REP: {log.transcription}"))
            else:
                messages.append(Message(role="user", content=f"PROSPECT: {log.transcription}"))
        messages.append(Message(role="user", content=user_prompt))

        raw = self.llm.get_text_from_speech(
            messages=messages,
            response_format={"type": "json_object"},
        )
        return json.loads(raw)
