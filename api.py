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
from backend._types import UserParams, Log
from backend.database import (
    init_db,
    create_session,
    insert_two_turns,
    update_session_status,
    save_analysis,
    list_sessions,
    get_session,
    get_turns,
    get_analysis,
)

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
    init_db()
    app.state.simulator = None
    app.state.simulator_task = None
    app.state.current_session_id = None


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
        analysis = ac.generate_summary()
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Persist to DB
    session_id = getattr(app.state, "current_session_id", None)
    if session_id:
        await asyncio.to_thread(save_analysis, session_id, analysis)
    return {"analysis": analysis}


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

    # Create a new session in DB
    session_id = await asyncio.to_thread(create_session, current_user_params)
    app.state.current_session_id = session_id

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
        "session_id": session_id,
        "scenario_params": sim.scenario_params,
        "prospect_role": sim.prospect_role,
        "prospect_name": sim.prospect_name,
        "prospect_company": sim.prospect_company,
    }


# ── Session history endpoints ─────────────────────────────────────────────────

@app.get("/sessions")
async def list_sessions_endpoint():
    sessions = await asyncio.to_thread(list_sessions)
    return {"sessions": sessions}


@app.get("/sessions/{session_id}")
async def get_session_detail(session_id: int):
    session = await asyncio.to_thread(get_session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    turns = await asyncio.to_thread(get_turns, session_id)
    analysis = await asyncio.to_thread(get_analysis, session_id)
    return {"session": session, "turns": turns, "analysis": analysis}


@app.get("/sessions/{session_id}/analysis")
async def get_session_analysis_endpoint(session_id: int):
    session = await asyncio.to_thread(get_session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    # Return cached analysis if available
    analysis = await asyncio.to_thread(get_analysis, session_id)
    if analysis:
        return {"analysis": analysis}
    # Otherwise run it against stored turns
    turns = await asyncio.to_thread(get_turns, session_id)
    if not turns:
        raise HTTPException(status_code=400, detail="No turns in this session")
    logs = [
        Log(role=t["role"], timestamp=t["timestamp"], audio="", transcription=t["transcription"])
        for t in turns
    ]
    ac = AnalyzeCall(call_logs=logs)
    try:
        result = ac.generate_summary()
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    await asyncio.to_thread(save_analysis, session_id, result)
    return {"analysis": result}


# ── Helpers ───────────────────────────────────────────────────────────────────

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
                if item.get("type") == "assistant_text":
                    await ws.send_text(json.dumps({
                        "type": "assistant_text",
                        "assistant": item["assistant"],
                    }))
                elif item.get("type") == "user_text":
                    await ws.send_text(json.dumps({
                        "type": "user_text",
                        "user": item["user"],
                    }))
                elif item.get("type") == "done":
                    await ws.send_text('{"type":"done"}')
                    # Persist the just-completed turn pair to DB
                    session_id = getattr(app.state, "current_session_id", None)
                    sim = getattr(app.state, "simulator", None)
                    if session_id and sim and len(sim.simulation_logs) >= 2:
                        user_log = sim.simulation_logs[-2]
                        asst_log = sim.simulation_logs[-1]
                        await asyncio.to_thread(insert_two_turns, session_id, user_log, asst_log)
                elif item.get("data"):
                    try:
                        chunk_bytes = base64.b64decode(item["data"], validate=True)
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

    # Mark session as completed on clean close
    session_id = getattr(app.state, "current_session_id", None)
    if session_id:
        await asyncio.to_thread(update_session_status, session_id, "completed")

    try:
        await ws.close()
    except Exception:
        pass
