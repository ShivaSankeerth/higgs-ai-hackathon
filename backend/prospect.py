import json
import re
from backend.llm import LLM
from backend._types import Message

THINK_RE = re.compile(r'(?is)<think\b[^>]*>.*?</think\s*>')

def _strip_think(text: str) -> str:
    cleaned = THINK_RE.sub('', text)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned

class Prospect(object):

    def __init__(self):
        self.llm = LLM()

    def generate_role(self, scenario_params: dict) -> dict:
        """Returns dict with keys: name, company, prompt."""
        with open("backend/prompts/init_prospect.txt", "r") as f:
            prompt_template = f.read()
        prompt = prompt_template.format(scenario=str(scenario_params))
        response = self.llm.get_chat_completion(
            messages=[Message(role="system", content=prompt)],
            model=self.llm.chat_model,
        )
        content = _strip_think(response.content)
        # Extract the first {...} JSON block from the response
        m = re.search(r'\{[\s\S]*\}', content)
        if m:
            try:
                data = json.loads(m.group())
                return {
                    "name": data.get("name", ""),
                    "company": data.get("company", ""),
                    "prompt": data.get("prompt", content),
                }
            except json.JSONDecodeError:
                pass
        # Fallback: treat the whole response as the prompt, name/company unknown
        return {"name": "", "company": "", "prompt": content}
