# SalesCoach AI — Voice-First Sales Training Simulator

> "A batting cage for sales reps" — practice against a realistic AI prospect, then get coached on exactly what to do better.

---

## The Problem

Sales reps only get to practice on real prospects. There's no safe environment to rehearse handling a skeptical CFO, recover from a bad opener, or nail a close before it matters. Roleplay with colleagues is awkward to schedule and usually too easy. Managers can't review every rep, every week.

## The Solution

A voice-native sales training platform where reps have live practice calls with a fully AI-generated prospect — configurable by role, industry, mood, objection type, and deal stage — and receive structured AI coaching after every session.

---

## Key Features

### Live Practice Call
- Configure a scenario: prospect role, industry, mood, deal stage, objection type, and gender
- The AI generates a unique prospect persona (name, company, backstory) for every session
- **Prospect Intel panel** — before saying a word, the rep sees pain severity, budget status, decision timeline, deal size, engagement level, and more
- Hold-to-talk mic with real-time transcript updating as the conversation unfolds
- Prospect responds via natural-sounding streamed audio (gendered voices: Jack or Linda)

### AI Coaching & Session History
- Every call is saved with full transcript and metadata
- Post-call analysis scores the rep across **6 dimensions**: discovery, objection handling, rapport, value communication, closing, and listening
- Animated score ring (1–10), dimension breakdown bars, improvement cards, and highlights
- Full session history with previous call review

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser (Next.js)                          │
│                                                                 │
│  Mic → Web Audio API → PCM samples → WAV encode → base64       │
│                                                                 │
│  WebSocket messages received:                                   │
│    assistant_text → show prospect response immediately          │
│    PCM chunks     → schedule via Web Audio API (streaming)      │
│    user_text      → fill in user transcription                  │
│    done           → unlock mic after audio finishes             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket  /ws/stream
                           │ REST       /submit_form, /sessions/*
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI + asyncio)                   │
│                                                                 │
│  submit_form ──► Simulator.__init__                             │
│                     └─► _generate_setup()  [1 LLM call]        │
│                           ├─ scenario params (deal size,        │
│                           │  budget, timeline, pain severity…)  │
│                           └─ prospect persona (name, company,   │
│                              character prompt)                  │
│                                                                 │
│  ws/stream ──► run_simulation() loop                            │
│    ┌─────────────────────────────────────────────────────┐     │
│    │  Receive audio (base64 WAV)                         │     │
│    │  │                                                  │     │
│    │  ├─► Resample to 16 kHz, chunk ≤4s (scipy)         │     │
│    │  │                                                  │     │
│    │  ├─► [concurrent tasks]                             │     │
│    │  │     ├─ Boson HiggsAudioM3  → prospect response  │     │
│    │  │     └─ Eigen higgs_asr_3   → rep transcription  │     │
│    │  │                                                  │     │
│    │  ├─► Send assistant_text immediately (Boson done)   │     │
│    │  │                                                  │     │
│    │  ├─► Stream TTS chunks via Eigen higgs2p5 WebSocket │     │
│    │  │     (PCM 16-bit, 24 kHz, mono → browser)        │     │
│    │  │                                                  │     │
│    │  ├─► Send user_text (ASR done)                     │     │
│    │  └─► Send done → mic unlocks after audio plays     │     │
│    └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  /sessions/{id}/analysis ──► AnalyzeCall                       │
│     └─► gpt-oss-120b → structured JSON scoring (6 dimensions)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Audio Pipeline Detail

### Rep → Prospect (input)
```
Browser mic
  → Web Audio API (ScriptProcessorNode, 4096-sample buffers)
  → Float32 PCM at native browser sample rate (44.1 / 48 kHz)
  → WAV encode (inline, no library)
  → base64 → WebSocket → backend

Backend:
  → scipy resample to 16 kHz mono
  → split into ≤4s chunks (≤64,000 samples each)
  → base64 WAV per chunk

  Concurrent:
    Chunk(s) → Boson HiggsAudioM3 (audio-in, text-out)
                 → prospect response text
    Full WAV  → Eigen higgs_asr_3 (audio-in, text-out)
                 → rep transcription (for coaching)
```

### Prospect → Rep (output)
```
Prospect response text
  → Eigen higgs2p5 WebSocket (streaming TTS)
      Step 1: {"token": API_KEY, "model": "higgs2p5"}
      Step 2: {"text": "...", "voice": "Jack" | "Linda"}
      Receive: binary PCM frames (16-bit, 24 kHz, mono)
               + {"type": "complete"}

  PCM chunks → base64 → WebSocket → browser
  Browser: Web Audio API schedules chunks sequentially
           (no gaps, low-latency streaming playback)
```

### Why This Is Fast
Boson AI and Eigen ASR run **in parallel**. The prospect's response is sent to the frontend the moment Boson AI returns — before TTS even starts. The user transcription fills in shortly after when ASR completes. TTS audio streams chunk-by-chunk so the first words play before the full response is generated. Perceived latency after the rep stops speaking: **~1.2 seconds**.

---

## Models Used

| Model | Provider | Role |
|---|---|---|
| `higgs-audio-understanding-v3.5` | Boson AI | Audio-in, text-out: understands rep's voice + generates prospect response in one shot |
| `higgs_asr_3` | Eigen AI | Speech-to-text: transcribes rep's side for coaching and session history |
| `higgs2p5` | Eigen AI | Text-to-speech: streams prospect's voice (Jack or Linda) via WebSocket |
| `gpt-oss-120b` | Eigen AI | Scenario+persona generation on call start; post-call coaching analysis |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| Backend | Python 3.11, FastAPI, asyncio |
| Real-time comms | WebSocket (bidirectional: audio in, PCM chunks out) |
| Audio processing | Web Audio API (browser), scipy + numpy (backend resampling) |
| Database | SQLite (session history, transcripts, coaching scores) |
| Deployment | Docker Compose (frontend :3000, backend :8000) |

---

## Project Structure

```
├── api.py                          # FastAPI server — WebSocket + REST endpoints
├── requirements.txt
├── docker-compose.yml
├── backend/
│   ├── simulator.py               # Core engine: setup, run_simulation loop
│   ├── llm.py                     # All model integrations (ASR, TTS, LLM, Boson)
│   ├── analyze_call.py            # Post-call scoring — 6-dimension rubric → JSON
│   ├── database.py                # SQLite: sessions, turns, analysis
│   ├── prospect.py                # Prospect persona fallback parser
│   ├── _types.py                  # Shared data models
│   └── prompts/
│       ├── init_setup.txt         # Combined scenario+persona generation prompt
│       ├── init_simulation.txt    # Prospect roleplay system prompt (injected each turn)
│       ├── generate_response.txt  # Turn-level response instructions + mood cues
│       └── summary_prompt.txt     # Post-call evaluation rubric
├── frontend/
│   ├── app/
│   │   ├── page.tsx               # Landing page
│   │   ├── simulate/page.tsx      # Live call UI
│   │   └── history/
│   │       ├── page.tsx           # Session history list
│   │       └── [id]/page.tsx      # Session review + coaching
│   └── lib/
│       └── api.ts                 # Typed API client
└── data/
    └── params.json                # Scenario parameter schema
```

---

## Getting Started

### Prerequisites
- Docker + Docker Compose
- Eigen AI API key (`API_KEY`, `BASE_URL`)
- Boson AI API key (`BOSONAI_API_KEY`)

### Quick Start

```bash
git clone https://github.com/ShivaSankeerth/higgs-ai-hackathon.git
cd higgs-ai-hackathon
cp .env.example .env
# Fill in API_KEY, BASE_URL, BOSONAI_API_KEY
docker-compose up --build
```

Frontend: http://localhost:3000 · Backend: http://localhost:8000

### Manual Setup

```bash
# Backend
pip install -r requirements.txt
uvicorn api:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

---

## How to Use

1. Go to **Practice Call** — configure your scenario
2. Click **Start Practice Call** — persona is generated, WebSocket connects
3. Review the **Prospect Intel** panel: name, company, pain severity, budget, timeline
4. Hold the mic button to speak, release to send
5. Click **End Call** → **Review & Get Coaching**
6. Click **Get AI Coaching Feedback** for the full analysis
