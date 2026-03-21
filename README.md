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
- **Input** — recorded roleplay sessions or uploaded real call recordings
- **Transcription** — full audio-to-text with speaker identification
- **Scoring** — performance rated across key dimensions (opener, discovery, objection handling, close)
- **Coaching feedback** — specific, actionable suggestions with timestamps
- **Progress tracking** — see improvement trends over time

## Architecture

```
┌─────────────────────────────────────────────┐
│              Frontend (React/Next.js)        │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Roleplay UI  │  │ Call Review UI      │  │
│  │ - Mic input   │  │ - Upload/select call│  │
│  │ - Live audio  │  │ - Transcript view   │  │
│  │ - AI prospect │  │ - Scoring dashboard │  │
│  │   responses   │  │ - Coaching feedback │  │
│  └──────────────┘  └─────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │
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
│  │     Higgs API Integration Layer      │   │
│  │  (STT / TTS / LLM — TBD)            │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Tech Stack (Tentative)
- **Frontend**: Next.js + React + TailwindCSS
- **Backend**: Python + FastAPI
- **Audio**: WebRTC / MediaRecorder API for browser audio capture
- **AI/Audio APIs**: Higgs-specific (pending API docs)
- **Database**: SQLite (hackathon scope) or PostgreSQL

## Implementation Phases

### Phase 1: Project Setup
- Initialize frontend and backend projects
- Set up project structure, shared types, environment config

### Phase 2: Core Roleplay Engine
- Browser audio capture
- STT -> LLM -> TTS pipeline via Higgs APIs
- Prospect persona system
- Real-time conversation loop
- Session recording and storage

### Phase 3: Call Review System
- Audio upload/selection UI
- Transcription pipeline
- Scoring rubric engine
- Coaching feedback generation
- Review dashboard UI

### Phase 4: Polish
- Pre-built scenario library
- Performance tracking dashboard
- UI/UX polish for demo

## Status
Early stage — awaiting Higgs API documentation to finalize integration approach and tech stack details.
