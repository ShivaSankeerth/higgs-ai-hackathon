import base64
import re
import time
import json
import asyncio
import logging
from pathlib import Path
from backend.llm import LLM
from backend._types import UserParams, Message, PROSPECT_MOOD, Log

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
        logger.info("Initializing sales simulator")
        setup = self._generate_setup(user_params)
        self.scenario_params = setup["scenario"]
        self.prospect_role = setup["prospect"]["prompt"]
        self.prospect_name = setup["prospect"]["name"]
        self.prospect_company = setup["prospect"]["company"]
        logger.info(f"Initialized scenario with params:\n{json.dumps(self.scenario_params, indent=2)}")
        logger.info(f"Initialized prospect: {self.prospect_name} at {self.prospect_company}")
        self.system_prompt = self.set_system_prompt(self.prospect_role)
        self.memory = []
        self.current_mood: PROSPECT_MOOD = user_params.mood
        self.gender: str = user_params.gender
        self.simulation_logs = []
        self.input_queue = input_queue
        self.output_queue = output_queue
        self.save_cache = False
        self.folder_name = user_params.generate_id()

    def set_system_prompt(self, prospect_role: str):
        with open("backend/prompts/init_simulation.txt", "r") as f:
            prompt_template = f.read()
        return prompt_template.format(role=prospect_role)

    def _generate_setup(self, user_params: UserParams) -> dict:
        """Single LLM call that generates both scenario params and prospect persona."""
        with open("backend/data/params.json", "r") as f:
            all_params = json.load(f)
        param_set = {}
        for group in all_params["system"].values():
            param_set.update(group)
        user_context = "\n".join(f"- {k}: {v}" for k, v in user_params.to_dict().items())
        with open("backend/prompts/init_setup.txt", "r") as f:
            prompt_template = f.read()
        prompt = prompt_template.format(param_set=str(param_set), user_context=user_context)
        response = self.llm.get_chat_completion(
            messages=[Message(role="system", content=prompt)],
            model=self.llm.chat_model,
        )
        content = response.content or ""
        m = re.search(r'\{[\s\S]*\}', content)
        if m:
            content = m.group()
        data = json.loads(content)
        # Merge user-selected params into scenario so they're available alongside system params
        data["scenario"].update(user_params.to_dict())
        return data

    async def transcribe_speech_in(self, speech_in: str) -> str:
        """Decode base64 WAV audio and transcribe via higgs_asr_3."""
        logger.info("Transcribing speech input")
        audio_bytes = base64.b64decode(speech_in)
        transcription = await _to_thread(self.llm.transcribe_audio, audio_bytes)
        logger.info(f"Transcription: {transcription}")
        return transcription

    def _build_boson_messages(self, audio_chunks: list[str]) -> list[dict]:
        """Build proper multi-turn messages for Boson AI.

        History turns are passed as text (user/assistant), current turn as audio_url chunks.
        This avoids stuffing the full history into the system prompt string.
        """
        with open("backend/prompts/generate_response.txt", "r") as f:
            resp_instructions = f.read()
        system_prompt = self.system_prompt + f"\n\n{resp_instructions.format(current_mood=self.current_mood)}"

        messages: list[dict] = [{"role": "system", "content": system_prompt}]

        # Append past turns as text
        for msg in self.memory:
            messages.append({"role": msg.role, "content": msg.content})

        # Append current turn as audio
        messages.append({
            "role": "user",
            "content": [
                {"type": "audio_url", "audio_url": {"url": f"data:audio/wav_{i};base64,{c}"}}
                for i, c in enumerate(audio_chunks)
            ],
        })

        return messages

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
                    await self.output_queue.put({"data": speech_out, "type": "chunk"})
                    await self.output_queue.put({"type": "done"})
                    time.sleep(3)
                except Exception:
                    logger.warning("Cache load failed, falling back to live processing.")
                    load_from_cache = False

            if not load_from_cache:
                audio_bytes = base64.b64decode(speech_in)
                audio_chunks = await asyncio.to_thread(self.llm._wav_to_boson_chunks, audio_bytes)
                if not audio_chunks:
                    logger.warning("Audio too short after resampling, skipping turn")
                    continue
                boson_messages = self._build_boson_messages(audio_chunks)
                # Launch ASR and Boson AI as independent concurrent tasks
                asr_task = asyncio.create_task(_to_thread(self.llm.transcribe_audio, audio_bytes))
                boson_task = asyncio.create_task(self.llm.get_boson_response(boson_messages))
                try:
                    text_out = await boson_task
                except Exception as e:
                    logger.warning(f"Boson AI response failed, skipping turn: {e}")
                    asr_task.cancel()
                    continue
                # Send prospect response immediately — don't wait for ASR
                await self.output_queue.put({"type": "assistant_text", "assistant": text_out})
                # Stream TTS while ASR finishes in the background
                all_chunks = []
                async for chunk_bytes in self.llm.stream_speech_from_text(text_out, self.current_mood, self.gender):
                    b64 = base64.b64encode(chunk_bytes).decode()
                    await self.output_queue.put({"data": b64, "type": "chunk"})
                    all_chunks.append(chunk_bytes)
                speech_out = base64.b64encode(b"".join(all_chunks)).decode() if all_chunks else ""
                # ASR should be done by now; collect result for logging and memory
                try:
                    transcript_in = await asr_task
                except Exception as e:
                    logger.warning(f"ASR failed: {e}")
                    transcript_in = ""
                transcript_in = transcript_in.strip() if transcript_in else ""
                # Send user transcription to fill in the placeholder on the frontend
                await self.output_queue.put({"type": "user_text", "user": transcript_in})

            logger.info(f"Turn complete: {transcript_in}")

            logs = [
                Log(role="user", timestamp=user_msg_ts, audio=speech_in, transcription=transcript_in),
                Log(role="assistant", timestamp=time.time(), audio=speech_out, transcription=text_out),
            ]
            self.simulation_logs.extend(logs)
            # "done" goes out after logs are appended so api.py writer can safely read them
            if not load_from_cache:
                await self.output_queue.put({"type": "done"})
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
