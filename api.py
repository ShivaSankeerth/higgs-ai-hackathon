import os
import json
import base64
import asyncio
from pathlib import Path
from typing import Optional
import binascii

from fastapi import FastAPI, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.simulator import Simulator
from backend.analyze_call import AnalyzeCall
from backend._types import UserParams

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

app = FastAPI(title="Sales Training Simulator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIO_SAVE_DIR = Path(os.getenv("AUDIO_SAVE_DIR", "./recordings"))
AUDIO_SAVE_DIR.mkdir(parents=True, exist_ok=True)

input_queue: asyncio.Queue = asyncio.Queue()
output_queue: asyncio.Queue = asyncio.Queue()

simulator_task: Optional[asyncio.Task] = None
current_user_params: Optional[UserParams] = None


@app.on_event("startup")
async def startup_event():
    app.state.simulator = None
    app.state.simulator_task = None


@app.get("/")
async def read_root():
    return {"message": "Sales Training Simulator API"}


@app.get("/params")
async def get_params():
    """Return available scenario parameters for the frontend."""
    with open("backend/data/params.json", "r") as f:
        params = json.load(f)
    return params


@app.get("/get_conversation")
async def get_conversation():
    sim = getattr(app.state, "simulator", None)
    if sim is None:
        raise HTTPException(status_code=400, detail="Simulator not started.")
    logs = getattr(sim, "simulation_logs", None)
    if not logs:
        raise HTTPException(status_code=400, detail="No simulation logs yet.")
    logs_snapshot = list(logs)
    return {"data": logs_snapshot}


@app.get("/analyze_conversation")
async def analyze_conversation():
    sim = getattr(app.state, "simulator", None)
    if sim is None:
        raise HTTPException(status_code=400, detail="Simulator not started.")
    logs = getattr(sim, "simulation_logs", None)
    if not logs:
        raise HTTPException(status_code=400, detail="No simulation logs yet.")
    logs_snapshot = list(logs)
    ac = AnalyzeCall(call_logs=logs_snapshot)
    try:
        summary = ac.generate_summary()
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"summary": summary}


@app.post("/submit_form")
async def submit_form(
    prospect_role: str = Form(...),
    industry: str = Form(...),
    objection_type: str = Form(...),
    deal_stage: str = Form(...),
    mood: str = Form(...),
    gender: str = Form(...),
):
    """Start (or restart) the Simulator with the form inputs."""
    global simulator_task, current_user_params

    current_user_params = UserParams(
        prospect_role=prospect_role,
        industry=industry,
        objection_type=objection_type,
        deal_stage=deal_stage,
        mood=mood,
        gender=gender,
    )

    if simulator_task and not simulator_task.done():
        simulator_task.cancel()
        try:
            await asyncio.sleep(0)
        except Exception:
            pass

    _empty_queue(input_queue)
    _empty_queue(output_queue)
    sim = Simulator(
        user_params=current_user_params,
        stream=False,
        input_queue=input_queue,
        output_queue=output_queue
    )
    simulator_task = asyncio.create_task(sim.run_simulation())

    app.state.simulator = sim
    app.state.simulator_task = simulator_task

    return {
        "message": "Simulator started successfully.",
        "params": current_user_params.to_dict(),
    }


def _extract_b64_from_text(t: str) -> Optional[str]:
    s = t.strip()
    if s.startswith("{"):
        try:
            s = json.loads(s).get("data", "").strip()
        except Exception:
            return None
    if s.startswith("data:"):
        try:
            s = s.split(",", 1)[1].strip()
        except Exception:
            return None
    try:
        base64.b64decode(s, validate=True)
        return s
    except Exception:
        return None


def _empty_queue(q: asyncio.Queue):
    while not q.empty():
        q.get_nowait()
        q.task_done()


@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket):
    await ws.accept()

    if current_user_params is None or simulator_task is None or simulator_task.done():
        await ws.send_text("Simulator not initialized. Submit form first.")
        await ws.close(code=1011)
        return

    stop = asyncio.Event()

    async def reader():
        try:
            while not stop.is_set():
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    stop.set()
                    break
                if msg["type"] == "websocket.receive":
                    t = msg.get("text")
                    if t is None:
                        continue
                    if t.strip().lower() == "close":
                        stop.set()
                        break
                    b64 = _extract_b64_from_text(t)
                    if b64:
                        await input_queue.put({"data": b64})
                    else:
                        await ws.send_text('{"error":"invalid_base64"}')
        except WebSocketDisconnect:
            stop.set()
        except Exception:
            stop.set()

    async def writer():
        try:
            while not stop.is_set():
                item = await output_queue.get()
                if not item:
                    continue
                b64 = item.get("data")
                if not b64:
                    continue
                try:
                    chunk_bytes = base64.b64decode(b64, validate=True)
                except (binascii.Error, ValueError):
                    continue
                await ws.send_bytes(chunk_bytes)
        except WebSocketDisconnect:
            stop.set()
        except Exception:
            stop.set()

    t_read = asyncio.create_task(reader())
    t_write = asyncio.create_task(writer())
    await stop.wait()

    for t in (t_read, t_write):
        t.cancel()
    await asyncio.gather(t_read, t_write, return_exceptions=True)

    try:
        await ws.close()
    except Exception:
        pass
