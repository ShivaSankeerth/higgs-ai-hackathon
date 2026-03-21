# Higgs Audio AI — Sales Rep Training Platform

> "A batting cage for sales reps" — practice, review, and improve before it matters.

## Problem

Sales reps only get to practice on real prospects. There's no safe environment to rehearse handling a skeptical CFO, recover from a bad opener, or nail a close before it matters. Managers can't review every rep, every week.

## Solution

An AI-powered sales training platform with two core capabilities:

### 1. Voice Roleplay Simulation
Practice against AI-powered prospect personas in real-time voice conversations.
- **Scenario selection** — choose prospect personas (skeptical CFO, technical buyer, budget-conscious VP, etc.)
- **Real-time voice interaction** — speak naturally, get realistic AI prospect responses
- **Configurable scenarios** — objections, personality traits, deal context, difficulty level
- **Session recording** — every practice session is saved for later review

### 2. Call Review & Coaching
AI-powered analysis, scoring, and actionable feedback on sales calls.
- **Transcription** — full audio-to-text with speaker identification
- **Scoring** — performance rated across 6 dimensions (opener, discovery, objection handling, value articulation, closing, active listening)
- **Coaching feedback** — specific, actionable suggestions referencing conversation moments

## Architecture

```
┌─────────────────────────────────────────────┐
│              Frontend (Next.js)              │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Roleplay UI  │  │ Call Review UI      │  │
│  │ - Mic input   │  │ - Transcript view   │  │
│  │ - Live audio  │  │ - Scoring dashboard │  │
│  │ - AI prospect │  │ - Coaching feedback │  │
│  │   responses   │  │                     │  │
│  └──────────────┘  └─────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ WebSocket + REST
                   ▼
┌─────────────────────────────────────────────┐
│           Backend (Python/FastAPI)            │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Roleplay     │  │ Review Engine       │  │
│  │ Engine       │  │ - Transcription     │  │
│  │ - Session    │  │ - Analysis pipeline │  │
│  │   management │  │ - Scoring rubric    │  │
│  │ - Turn mgmt  │  │ - Feedback gen      │  │
│  └──────┬───────┘  └────────┬────────────┘  │
│         │                    │               │
│         ▼                    ▼               │
│  ┌──────────────────────────────────────┐   │
│  │     Higgs / Boson AI Integration     │   │
│  │  STT: higgs-audio-understanding      │   │
│  │  TTS: higgs-audio-generation          │   │
│  │  LLM: Qwen3-32B-non-thinking         │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Tech Stack
- **Frontend**: Next.js + React + TailwindCSS
- **Backend**: Python + FastAPI
- **Audio**: WebSocket streaming + MediaRecorder API
- **AI/Audio APIs**: Boson AI / Higgs models (ASR, TTS, LLM)
- **Deployment**: Docker Compose (2 services: frontend + backend)

## Project Structure

```
├── api.py                          # FastAPI server (WebSocket + REST)
├── requirements.txt                # Python dependencies
├── Dockerfile.backend              # Backend container
├── docker-compose.yml              # 2-service orchestration
├── .env.example                    # API key config template
├── backend/
│   ├── simulator.py               # Core roleplay engine (STT → LLM → TTS)
│   ├── prospect.py                # AI prospect persona generation
│   ├── scenario.py                # Sales scenario parameter generation
│   ├── analyze_call.py            # Post-call scoring & coaching
│   ├── llm.py                     # Higgs/Boson AI model integration
│   ├── session.py                 # Context-isolated sessions
│   ├── utils.py                   # Emotion templates + helpers
│   ├── _types.py                  # Data models
│   ├── prompts/
│   │   ├── init_simulation.txt    # Prospect roleplay system prompt
│   │   ├── init_prospect.txt      # Prospect persona generator
│   │   ├── init_scenario.txt      # Scenario parameter instantiation
│   │   ├── generate_response.txt  # Turn-by-turn response instructions
│   │   └── summary_prompt.txt     # Post-call evaluation rubric
│   └── data/
│       ├── params.json            # Scenario parameters (roles, industries, objections)
│       └── emotion_templates.json # Prospect mood voice templates
└── frontend/
    ├── Dockerfile                 # Frontend container
    ├── app/
    │   ├── page.tsx               # Landing page
    │   ├── simulate/page.tsx      # Live call UI (mic + WebSocket)
    │   └── review/page.tsx        # Transcript + coaching feedback
    └── lib/
        └── api.ts                 # Backend API client
```

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 20+
- A Boson AI / Higgs API key

### Quick Start

1. **Clone and configure**
   ```bash
   git clone <repo-url> && cd higgs-ai-hackathon
   cp .env.example .env
   # Edit .env and add your API_KEY and BASE_URL
   ```

2. **Run the backend**
   ```bash
   pip install -r requirements.txt
   uvicorn api:app --host 0.0.0.0 --port 8000
   ```

3. **Run the frontend** (in a separate terminal)
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. Open http://localhost:3000

### Docker (alternative)
```bash
docker-compose up
```
Frontend on `:3000`, backend on `:8000`.

## Status
MVP complete — core roleplay engine and review system are functional.
