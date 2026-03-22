import base64
import time
import json
import asyncio
import logging
import random
from pathlib import Path
from backend.llm import LLM
from backend.scenario import Scenario
from backend.prospect import Prospect
from backend._types import UserParams, Message, PROSPECT_MOOD, Log
from backend.utils import memory_to_string

logger = logging.getLogger(__name__)


async def _to_thread(fn, *a, **kw):
    return await asyncio.to_thread(fn, *a, **kw)


class Simulator(object):

    def __init__(self,
        user_params: UserParams,
        input_queue: asyncio.Queue,
        output_queue: asyncio.Queue,
        stream: bool = False
    ):
        self.llm = LLM()
        prospect = Prospect()
        scenario = Scenario()
        logger.info("Initializing sales simulator")
        self.scenario_params = scenario.get_scenario_params(user_params)
        logger.info(f"Initialized scenario with params:\n{json.dumps(self.scenario_params, indent=2)}")
        time.sleep(1 + random.uniform(0, 0.5))  # avoid back-to-back rate limit
        self.prospect_role = prospect.generate_role(self.scenario_params)
        logger.info(f"Initialized prospect with role: {self.prospect_role}")
        self.system_prompt = self.set_system_prompt(self.prospect_role)
        self.memory = []
        self.current_mood: PROSPECT_MOOD = user_params.mood
        self.simulation_logs = []
        self.input_queue = input_queue
        self.output_queue = output_queue
        self.save_cache = False
        self.folder_name = user_params.generate_id()

    def set_system_prompt(self, prospect_role: str):
        with open("backend/prompts/init_simulation.txt", "r") as f:
            prompt_template = f.read()
        return prompt_template.format(role=prospect_role)

    async def transcribe_speech_in(self, speech_in: str) -> str:
        """Decode base64 WAV audio and transcribe via higgs_asr_3."""
        logger.info("Transcribing speech input")
        audio_bytes = base64.b64decode(speech_in)
        transcription = await _to_thread(self.llm.transcribe_audio, audio_bytes)
        logger.info(f"Transcription: {transcription}")
        return transcription

    async def get_text_out(self, transcript_in: str) -> str:
        """Generate prospect response text from user transcript using gpt-oss-120b."""
        memory_str = memory_to_string(self.memory.copy())
        prompt = self.system_prompt + f"\n\n#CONVERSATION HISTORY:\n{memory_str}"
        with open("backend/prompts/generate_response.txt", "r") as f:
            resp_instructions = f.read()
        prompt = prompt + f"\n\n{resp_instructions.format(current_mood=self.current_mood)}"

        messages = [
            Message(role="system", content=prompt),
            Message(role="user", content=transcript_in),
        ]

        logger.info("Generating prospect response")
        def _call():
            return self.llm.get_chat_completion(
                model=self.llm.chat_model,
                messages=messages,
                temperature=0.7,
            ).content
        res = await _to_thread(_call)
        logger.info(res)
        return res

    def get_speech_out(self, text_out: str) -> str:
        """Convert prospect response text to base64 WAV audio via higgs2p5."""
        audio_bytes = self.llm.get_speech_from_text(text_out)
        return base64.b64encode(audio_bytes).decode("utf-8")

    async def run_simulation(self, load_from_cache=False):
        counter = 0
        while True:
            payload = await self.input_queue.get()
            if payload is None:
                logger.info("Ending simulation loop")
                break
            counter += 1
            user_msg_ts = time.time()
            speech_in = payload["data"]
            logger.info("Received speech input from user")

            transcript_in, text_out, speech_out = None, None, None

            if load_from_cache:
                try:
                    logger.info("Loading from logs")
                    with open(f"backend/recordings/{self.folder_name}/log_{counter}.json", "r") as f:
                        cache = json.load(f)
                    transcript_in = cache[0]["transcription"]
                    text_out = cache[1]["transcription"]
                    speech_out = cache[1]["audio"]
                    time.sleep(3)
                except Exception:
                    logger.warning("Cache load failed, falling back to live processing.")
                    load_from_cache = False

            if not load_from_cache:
                try:
                    transcript_in = await self.transcribe_speech_in(speech_in)
                except Exception as e:
                    logger.warning(f"ASR failed, skipping turn: {e}")
                    continue
                if not transcript_in or not transcript_in.strip():
                    logger.warning("Empty transcription, skipping turn")
                    continue
                text_out = await self.get_text_out(transcript_in)
                speech_out = await _to_thread(self.get_speech_out, text_out)

            await self.output_queue.put({"data": speech_out})
            logger.info(f"Turn complete: {transcript_in}")

            logs = [
                Log(role="user", timestamp=user_msg_ts, audio=speech_in, transcription=transcript_in),
                Log(role="assistant", timestamp=time.time(), audio=speech_out, transcription=text_out),
            ]
            self.simulation_logs.extend(logs)
            self.memory.extend([
                Message(role="user", content=transcript_in),
                Message(role="assistant", content=text_out),
            ])
            if self.save_cache:
                log_dir = Path(f"backend/recordings/{self.folder_name}")
                log_dir.mkdir(parents=True, exist_ok=True)
                with open(log_dir / f"log_{counter}.json", "w") as f:
                    json.dump([l.to_dict() for l in logs], f, indent=2)

        return self.simulation_logs
