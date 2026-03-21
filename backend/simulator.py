import time
import json
import asyncio
import logging
from pathlib import Path
from backend.llm import LLM
from backend.scenario import Scenario
from backend.prospect import Prospect
from backend._types import UserParams, Message, MessageContent, InputAudio, PROSPECT_MOOD, Log
from backend.utils import get_emotion_template, memory_to_string

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
        self.prospect_role = prospect.generate_role(self.scenario_params)
        logger.info(f"Initialized prospect with role: {self.prospect_role}")
        self.system_prompt = self.set_system_prompt(self.prospect_role)
        self.emotion_template = get_emotion_template(
            emotion=user_params.mood,
            gender=user_params.gender
        )
        self.memory = []
        self.stream = stream
        self.current_mood: PROSPECT_MOOD = user_params.mood
        self.gender = user_params.gender
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
        prompt = "Transcribe the given user audio. Output only the transcription."
        logger.info("Transcribing speech input")
        def _call():
            messages = [
                Message(role="system", content=prompt),
                Message(role="user", content=[MessageContent(type="input_audio", input_audio=InputAudio(data=speech_in, format="wav"))])
            ]
            completion = self.llm.get_chat_completion(
                model=self.llm.asr_model,
                messages=messages
            ).content
            return completion
        transcription = await _to_thread(_call)
        logger.info(f"Transcription: {transcription}")
        return transcription

    async def get_text_out(self, speech_in: str):
        memory_str = memory_to_string(self.memory.copy())
        prompt = self.system_prompt + f"\n\n#CONVERSATION HISTORY:\n{memory_str}"
        with open("backend/prompts/generate_response.txt", "r") as f:
            resp_instructions = f.read()
        resp_instructions = resp_instructions.format(current_mood=self.current_mood)
        prompt = prompt + f"\n\n{resp_instructions}"

        messages = [
            Message(role="system", content=prompt),
            Message(role="user", content=[MessageContent(type="input_audio", input_audio=InputAudio(data=speech_in, format="wav"))])
        ]

        logger.info("Generating prospect response")
        def _call():
            completion = self.llm.get_chat_completion(
                model=self.llm.asr_model,
                messages=messages,
                temperature=0.0
            ).content
            return completion
        res = await _to_thread(_call)
        logger.info(res)
        return res

    def get_speech_out(self, text_out):
        messages = get_emotion_template(
            emotion=self.current_mood,
            gender=self.gender
        )
        messages.append(Message(
            role="user",
            content=f"[SPEAKER] {text_out}"
        ))
        generator = self.llm.get_speech_from_chat_completion(messages, self.stream)
        data = next(generator)
        return data

    async def run_simulation(self, load_from_cache=False):
        counter = 0
        transcript_in, text_out, speech_out = None, None, None
        while True:
            payload = await self.input_queue.get()
            if payload is None:
                logger.info("Ending simulation loop")
                break
            counter += 1
            user_msg_ts = time.time()
            speech_in = payload["data"]
            logger.info("Received speech input from user")

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
                transcript_in = await self.transcribe_speech_in(speech_in)
                text_out = await self.get_text_out(speech_in)
                speech_out = self.get_speech_out(text_out)

            await self.output_queue.put({"data": speech_out})
            logger.info(f"Completed simulation for input msg: {transcript_in}")
            logs = [
                Log(
                    role="user",
                    timestamp=user_msg_ts,
                    audio=speech_in,
                    transcription=transcript_in
                ),
                Log(
                    role="assistant",
                    timestamp=time.time(),
                    audio=speech_out,
                    transcription=text_out
                )
            ]
            self.simulation_logs.extend(logs)
            self.memory.extend([
                Message(role="user", content=transcript_in),
                Message(role="assistant", content=text_out)
            ])
            if self.save_cache:
                log_dir = Path(f"backend/recordings/{self.folder_name}")
                log_dir.mkdir(parents=True, exist_ok=True)
                log_path = log_dir / f"log_{counter}.json"
                logger.info(f"Saving to {log_path}")
                with open(log_path, "w") as f:
                    d = [l.to_dict() for l in logs]
                    json.dump(d, f, indent=2)
        return self.simulation_logs
