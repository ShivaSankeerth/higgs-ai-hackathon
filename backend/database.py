import json
import time
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

DB_PATH = Path("/app/data/simulator.db")


def _engine():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(
        f"sqlite:///{DB_PATH}",
        connect_args={"check_same_thread": False},
    )


engine = _engine()


def init_db():
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                prospect_role   TEXT NOT NULL,
                industry        TEXT NOT NULL,
                objection_type  TEXT NOT NULL,
                deal_stage      TEXT NOT NULL,
                mood            TEXT NOT NULL,
                gender          TEXT NOT NULL,
                created_at      REAL NOT NULL,
                status          TEXT NOT NULL DEFAULT 'in_progress'
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversation_turns (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      INTEGER NOT NULL REFERENCES sessions(id),
                role            TEXT NOT NULL,
                transcription   TEXT NOT NULL,
                timestamp       REAL NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_turns_session
            ON conversation_turns(session_id)
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS call_analyses (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id          INTEGER NOT NULL UNIQUE REFERENCES sessions(id),
                overall_score       REAL NOT NULL,
                dimensions_json     TEXT NOT NULL,
                improvements_json   TEXT NOT NULL,
                highlights_json     TEXT NOT NULL,
                created_at          REAL NOT NULL
            )
        """))
        conn.commit()


# ── Sync DB operations (called via asyncio.to_thread) ─────────────────────────

def create_session(user_params) -> int:
    with Session(engine) as s:
        result = s.execute(text("""
            INSERT INTO sessions
              (prospect_role, industry, objection_type, deal_stage, mood, gender, created_at, status)
            VALUES
              (:prospect_role, :industry, :objection_type, :deal_stage, :mood, :gender, :created_at, 'in_progress')
        """), {**user_params.to_dict(), "created_at": time.time()})
        s.commit()
        return result.lastrowid


def insert_two_turns(session_id: int, user_log, asst_log):
    with Session(engine) as s:
        for log in (user_log, asst_log):
            s.execute(text("""
                INSERT INTO conversation_turns (session_id, role, transcription, timestamp)
                VALUES (:session_id, :role, :transcription, :timestamp)
            """), {
                "session_id": session_id,
                "role": log.role,
                "transcription": log.transcription,
                "timestamp": log.timestamp,
            })
        s.commit()


def update_session_status(session_id: int, status: str):
    with Session(engine) as s:
        s.execute(
            text("UPDATE sessions SET status = :status WHERE id = :id"),
            {"status": status, "id": session_id},
        )
        s.commit()


def save_analysis(session_id: int, analysis: dict):
    with Session(engine) as s:
        s.execute(text("""
            INSERT OR REPLACE INTO call_analyses
              (session_id, overall_score, dimensions_json, improvements_json, highlights_json, created_at)
            VALUES
              (:session_id, :overall_score, :dimensions_json, :improvements_json, :highlights_json, :created_at)
        """), {
            "session_id": session_id,
            "overall_score": analysis["overall_score"],
            "dimensions_json": json.dumps(analysis["dimensions"]),
            "improvements_json": json.dumps(analysis["improvements"]),
            "highlights_json": json.dumps(analysis["highlights"]),
            "created_at": time.time(),
        })
        s.commit()


def list_sessions() -> list:
    with Session(engine) as s:
        rows = s.execute(text("""
            SELECT s.id, s.prospect_role, s.industry, s.objection_type, s.deal_stage,
                   s.mood, s.gender, s.created_at, s.status,
                   COUNT(t.id) AS turn_count,
                   MAX(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS has_analysis
            FROM sessions s
            LEFT JOIN conversation_turns t ON t.session_id = s.id
            LEFT JOIN call_analyses a ON a.session_id = s.id
            GROUP BY s.id
            ORDER BY s.created_at DESC
        """)).mappings().all()
        return [dict(r) for r in rows]


def get_session(session_id: int) -> Optional[dict]:
    with Session(engine) as s:
        row = s.execute(
            text("SELECT * FROM sessions WHERE id = :id"),
            {"id": session_id},
        ).mappings().first()
        return dict(row) if row else None


def get_turns(session_id: int) -> list:
    with Session(engine) as s:
        rows = s.execute(text("""
            SELECT role, transcription, timestamp
            FROM conversation_turns
            WHERE session_id = :id
            ORDER BY timestamp ASC
        """), {"id": session_id}).mappings().all()
        return [dict(r) for r in rows]


def get_analysis(session_id: int) -> Optional[dict]:
    with Session(engine) as s:
        row = s.execute(
            text("SELECT * FROM call_analyses WHERE session_id = :id"),
            {"id": session_id},
        ).mappings().first()
        if not row:
            return None
        d = dict(row)
        d["dimensions"] = json.loads(d.pop("dimensions_json"))
        d["improvements"] = json.loads(d.pop("improvements_json"))
        d["highlights"] = json.loads(d.pop("highlights_json"))
        return d
