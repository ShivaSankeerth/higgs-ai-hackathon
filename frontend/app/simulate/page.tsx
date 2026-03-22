"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  fetchParams,
  submitForm,
  getConversation,
  type ScenarioParams,
  type FormData,
} from "@/lib/api";

type Phase = "setup" | "connecting" | "live" | "ended";

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── WAV encoding ────────────────────────────────────────────────────────────

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodePCMtoWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buf;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SimulatePage() {
  const [params, setParams] = useState<ScenarioParams | null>(null);
  const [form, setForm] = useState<FormData>({
    prospect_role: "",
    industry: "",
    objection_type: "",
    deal_stage: "",
    mood: "",
    gender: "",
  });
  const [phase, setPhase] = useState<Phase>("setup");
  const [transcript, setTranscript] = useState<{ role: string; text: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [micLocked, setMicLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Web Audio recording
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    fetchParams()
      .then((p) => {
        setParams(p);
        setForm({
          prospect_role: p.user.prospect.prospect_role[0],
          industry: p.user.prospect.industry[0],
          objection_type: p.user.deal.objection_type[0],
          deal_stage: p.user.deal.deal_stage[0],
          mood: p.user.prospect.mood[0],
          gender: p.user.prospect.gender[0],
        });
      })
      .catch(() => setError("Could not connect to backend. Is it running?"));
  }, []);

  const refreshTranscript = useCallback(async () => {
    try {
      const { data } = await getConversation();
      setTranscript(
        data.map((log) => ({
          role: log.role === "user" ? "user" : "prospect",
          text: log.transcription,
        }))
      );
    } catch {
      // ignore
    }
  }, []);

  const playAudio = useCallback(async (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    setMicLocked(true);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setMicLocked(false);
      refreshTranscript();
    };
    await audio.play().catch(() => {
      setMicLocked(false);
      URL.revokeObjectURL(url);
    });
  }, [refreshTranscript]);

  const handleStart = async () => {
    setError(null);
    setPhase("connecting");
    try {
      await submitForm(form);
      const ws = createWebSocket();
      wsRef.current = ws;
      ws.onopen = () => setPhase("live");
      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          await playAudio(event.data);
        }
      };
      ws.onerror = () => { setError("WebSocket error"); setPhase("setup"); };
      ws.onclose = () => { if (phase !== "ended") setPhase("ended"); };
    } catch {
      setError("Failed to start simulation");
      setPhase("setup");
    }
  };

  const startRecording = async () => {
    if (micLocked || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      samplesRef.current = [];

      processor.onaudioprocess = (e) => {
        samplesRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      setIsRecording(true);
    } catch {
      setError("Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;

    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
    audioCtxRef.current?.close();

    const chunks = samplesRef.current;
    const totalLen = chunks.reduce((n, c) => n + c.length, 0);

    if (totalLen < sampleRate * 0.3) {
      // Less than 300ms — too short, discard
      setIsRecording(false);
      return;
    }

    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }

    const wav = encodePCMtoWAV(merged, sampleRate);
    const b64 = arrayBufferToBase64(wav);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ data: b64 }));
      setTranscript((prev) => [
        ...prev,
        { role: "user", text: "[Speaking — waiting for prospect...]" },
      ]);
    }
    setIsRecording(false);
  };

  const endCall = () => {
    wsRef.current?.send("close");
    wsRef.current?.close();
    setPhase("ended");
  };

  if (!params) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        {error ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <Link href="/" className="text-blue-400 underline">Back home</Link>
          </div>
        ) : (
          <p>Loading scenarios...</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">&larr; Home</Link>
        <h1 className="text-lg font-semibold">Practice Call</h1>
        <div className="w-16" />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-6 text-sm">{error}</div>
        )}

        {phase === "setup" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Configure Your Scenario</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { key: "prospect_role" as const, label: "Prospect Role", options: params.user.prospect.prospect_role },
                { key: "industry" as const, label: "Industry", options: params.user.prospect.industry },
                { key: "mood" as const, label: "Prospect Mood", options: params.user.prospect.mood },
                { key: "gender" as const, label: "Prospect Gender", options: params.user.prospect.gender },
                { key: "objection_type" as const, label: "Objection Type", options: params.user.deal.objection_type },
                { key: "deal_stage" as const, label: "Deal Stage", options: params.user.deal.deal_stage },
              ].map(({ key, label, options }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-400 mb-1">{label}</label>
                  <select
                    value={form[key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt}>{formatLabel(opt)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              onClick={handleStart}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Start Practice Call
            </button>
          </div>
        )}

        {phase === "connecting" && (
          <div className="text-center py-20">
            <div className="animate-pulse text-xl">Setting up your scenario...</div>
            <p className="text-gray-400 mt-2">Generating prospect persona and connecting</p>
          </div>
        )}

        {phase === "live" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400 font-medium">Call in progress</span>
              </div>
              <button
                onClick={endCall}
                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                End Call
              </button>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 min-h-[200px] max-h-[400px] overflow-y-auto">
              {transcript.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Hold the mic button to speak to the prospect
                </p>
              ) : (
                <div className="space-y-3">
                  {transcript.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.role === "user" ? "bg-blue-600" : "bg-gray-700"}`}>
                        <div className="text-xs text-gray-400 mb-1">{msg.role === "user" ? "You" : "Prospect"}</div>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={micLocked}
                className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all ${
                  micLocked
                    ? "bg-gray-600 opacity-50 cursor-not-allowed"
                    : isRecording
                    ? "bg-red-500 scale-110 shadow-lg shadow-red-500/50"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
              >
                🎤
              </button>
              <p className="text-gray-500 text-sm">
                {micLocked
                  ? "Prospect is speaking..."
                  : isRecording
                  ? "Recording — release to send"
                  : "Hold to record, release to send"}
              </p>
            </div>
          </div>
        )}

        {phase === "ended" && (
          <div className="text-center py-20 space-y-6">
            <h2 className="text-2xl font-bold">Call Ended</h2>
            <p className="text-gray-400">Great practice! Review your performance or start another call.</p>
            <div className="flex gap-4 justify-center">
              <Link
                href="/review"
                className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Review &amp; Get Coaching
              </Link>
              <button
                onClick={() => { setPhase("setup"); setTranscript([]); }}
                className="bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-xl font-medium transition-colors"
              >
                New Call
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function createWebSocket(): WebSocket {
  const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/stream";
  return new WebSocket(WS_URL);
}
