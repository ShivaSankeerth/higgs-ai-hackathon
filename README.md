# Higgs Audio AI — Sales Rep Training Platform

> "A batting cage for sales reps" — practice, review, and improve before it matters.

## Problem

Sales reps only get to practice on real prospects. There's no safe environment to rehearse handling a skeptical CFO, recover from a bad opener, or nail a close before it matters. Managers can't review every rep, every week.

## Solution

An AI-powered sales training platform with two core capabilities:

### 1. Voice Roleplay Simulation
Practice against AI-powered prospect personas in real-time voice conversations.
- **Scenario selection** — choose prospect role, industry, mood, objection type, and deal stage
- **Real-time voice interaction** — speak naturally, get realistic AI prospect responses
- **Mic locking** — mic disables while the prospect is speaking, just like a real call
- **Live transcript** — conversation updates in real time after each exchange

### 2. Call Review & Coaching
AI-powered analysis, scoring, and actionable feedback on sales calls.
- **Auto-loaded transcript** — collapsible call history shown immediately on the review page
- **Overall score** — animated ring indicator (1–10) with color coding
- **Dimension breakdown** — scored across 6 dimensions with color-coded bars and per-dimension feedback
- **Improvement cards** — specific, actionable notes referencing moments in the call, tagged by dimension
- **Highlights** — what you actually did well

## Architecture

```
┌─────────────────────────────────────────────┐
│              Frontend (Next.js)              │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Roleplay UI  │  │ Call Review UI      │  │
│  │ - Mic input  │  │ - Score ring        │  │
│  │ - WAV encode │  │ - Dimension cards   │  │
│  │ - WS stream  │  │ - Coaching feedback │  │
│  └──────────────┘  └─────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ WebSocket + REST
                   ▼
┌─────────────────────────────────────────────┐
│           Backend (Python/FastAPI)           │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Simulator    │  │ AnalyzeCall         │  │
│  │ - ASR turn   │  │ - Transcript → LLM  │  │
│  │ - LLM resp   │  │ - JSON scoring      │  │
│  │ - TTS reply  │  │ - 6-dim rubric      │  │
│  └──────┬───────┘  └────────┬────────────┘  │
│         │                   │               │
│         ▼                   ▼               │
│  ┌──────────────────────────────────────┐   │
│  │          Eigen AI Integration        │   │
│  │  ASR: higgs_asr_3  (speech → text)   │   │
│  │  TTS: higgs2p5     (text → speech)   │   │
│  │  LLM: gpt-oss-120b (chat completion) │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Audio Pipeline

```
Browser mic → Web Audio API (ScriptProcessorNode)
           → PCM samples → WAV encode (inline)
           → base64 → WebSocket → backend
           → higgs_asr_3 → transcript
           → gpt-oss-120b → prospect response text
           → higgs2p5 → WAV bytes
           → base64 → WebSocket → browser
           → HTML5 Audio playback
```

## Tech Stack
- **Frontend**: Next.js + React + TailwindCSS
- **Backend**: Python + FastAPI + asyncio queues
- **Audio**: WebSocket + Web Audio API (WAV, batch)
- **AI APIs**: Eigen AI — `higgs_asr_3`, `higgs2p5`, `gpt-oss-120b`
- **Deployment**: Docker Compose (frontend :3000, backend :8000)

## Project Structure

```
├── api.py                          # FastAPI server (WebSocket + REST)
├── requirements.txt                # Python dependencies
├── Dockerfile.backend              # Backend container
├── docker-compose.yml              # 2-service orchestration
├── .env.example                    # API key config template
├── backend/
│   ├── simulator.py               # Core roleplay engine (ASR → LLM → TTS)
│   ├── prospect.py                # AI prospect persona generation
│   ├── scenario.py                # Sales scenario parameter generation
│   ├── analyze_call.py            # Post-call scoring & coaching (structured JSON)
│   ├── llm.py                     # Eigen AI model integration
│   ├── utils.py                   # Conversation memory helpers
│   ├── _types.py                  # Data models
│   ├── prompts/
│   │   ├── init_simulation.txt    # Prospect roleplay system prompt
│   │   ├── init_prospect.txt      # Prospect persona generator
│   │   ├── init_scenario.txt      # Scenario parameter instantiation
│   │   ├── generate_response.txt  # Turn-by-turn response instructions
│   │   └── summary_prompt.txt     # Post-call evaluation rubric (JSON output)
│   └── data/
│       └── params.json            # Scenario parameters (roles, industries, objections)
└── frontend/
    ├── Dockerfile                 # Frontend container
    ├── app/
    │   ├── page.tsx               # Landing page
    │   ├── simulate/page.tsx      # Live call UI (mic + WebSocket)
    │   └── review/page.tsx        # Coaching dashboard
    └── lib/
        └── api.ts                 # Backend API client + types
```

## Getting Started

### Prerequisites
- Docker + Docker Compose (recommended)
- An Eigen AI API key

### Quick Start (Docker)

```bash
git clone <repo-url> && cd higgs-ai-hackathon
cp .env.example .env
# Add your API_KEY and BASE_URL to .env
docker-compose up --build
```

Frontend: http://localhost:3000 · Backend: http://localhost:8000

### Manual Setup

```bash
# Backend
pip install -r requirements.txt
uvicorn api:app --host 0.0.0.0 --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Usage

1. Go to **Practice Call** — configure your scenario (prospect role, industry, objection type, etc.)
2. Click **Start Practice Call** — the AI prospect is initialized and the WebSocket connects
3. Hold the mic button to speak, release to send — the prospect responds via audio
4. Click **End Call** when done, then go to **Review & Get Coaching**
5. The transcript auto-loads; click **Get AI Coaching Feedback** for the full analysis

## Status
MVP complete — voice roleplay and structured coaching review are both functional.
