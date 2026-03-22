"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  fetchParams,
  submitForm,
  getConversation,
  type ScenarioParams,
  type FormData,
  type ProspectBrief,
} from "@/lib/api";

type Phase = "setup" | "connecting" | "live" | "ended";

const ACRONYMS = new Set(["cfo", "cto", "ceo", "vp", "hr", "it"]);

const INTEL_SIGNALS: { label: string; key: string }[] = [
  { label: "Pain Severity", key: "pain_severity" },
  { label: "Budget", key: "budget_status" },
  { label: "Timeline", key: "decision_timeline" },
  { label: "Engagement", key: "willingness_to_engage" },
  { label: "Deal Size", key: "deal_size" },
  { label: "Company", key: "company_size" },
  { label: "Prior Contact", key: "prior_contact" },
  { label: "Committee", key: "buying_committee_size" },
];

function signalColor(key: string, value: string): string {
  const v = (value || "").toLowerCase();
  switch (key) {
    case "pain_severity":
      if (v.includes("hair") || v.includes("critical")) return "text-red-400";
      if (v.includes("moderate")) return "text-orange-400";
      return "text-yellow-400";
    case "budget_status":
      if (v === "approved" || v.includes("surplus")) return "text-green-400";
      if (v.includes("pending")) return "text-yellow-400";
      return "text-red-400";
    case "decision_timeline":
      if (v.includes("urgent") || v.includes("week")) return "text-red-400";
      if (v.includes("month")) return "text-orange-400";
      if (v.includes("quarter")) return "text-yellow-400";
      return "text-gray-400";
    case "willingness_to_engage":
      if (v === "open") return "text-green-400";
      if (v === "cautious") return "text-yellow-400";
      if (v === "resistant" || v === "hostile") return "text-red-400";
      return "text-gray-300";
    default:
      return "text-gray-200";
  }
}

const SETUP_STEPS = [
  "Analyzing your parameters...",
  "Generating prospect persona...",
  "Briefing your prospect...",
  "Establishing connection...",
];

function formatLabel(s: string): string {
  return s
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
  const [setupStep, setSetupStep] = useState(0);
  const [brief, setBrief] = useState<ProspectBrief | null>(null);
  const [intelOpen, setIntelOpen] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<number | null>(null);

  // Web Audio recording refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);

  // Streaming playback refs
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);

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

  useEffect(() => {
    if (phase !== "connecting") return;
    setSetupStep(0);
    const id = setInterval(() => {
      setSetupStep((prev) => Math.min(prev + 1, SETUP_STEPS.length - 1));
    }, 800);
    return () => clearInterval(id);
  }, [phase]);

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

  const scheduleChunk = useCallback((rawPcm: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    const view = new DataView(rawPcm);
    const samples = new Float32Array(rawPcm.byteLength / 2);
    for (let i = 0; i < samples.length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;

    const buf = ctx.createBuffer(1, samples.length, 24000);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime, nextStartTimeRef.current);
    src.start(t);
    nextStartTimeRef.current = t + buf.duration;
  }, []);

  const handleStart = async () => {
    setError(null);
    setPhase("connecting");
    try {
      const formRes = await submitForm(form);
      sessionIdRef.current = formRes.session_id ?? null;
      setBrief({
        scenario_params: formRes.scenario_params,
        prospect_role: formRes.prospect_role,
        prospect_name: formRes.prospect_name,
        prospect_company: formRes.prospect_company,
      });
      setIntelOpen(true);
      const ws = createWebSocket();
      wsRef.current = ws;
      ws.onopen = () => setPhase("live");
      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "assistant_text") {
              // Prospect response ready — append immediately below the user placeholder
              setTranscript((prev) => [...prev, { role: "prospect", text: msg.assistant }]);
            } else if (msg.type === "user_text") {
              // ASR finished — replace the speaking placeholder with real transcription
              setTranscript((prev) =>
                prev.map((m) =>
                  m.text === "[Speaking — waiting for prospect...]"
                    ? { ...m, text: msg.user || "(no transcription)" }
                    : m
                )
              );
            } else if (msg.type === "done") {
              setMicLocked(true);
              const ctx = playbackCtxRef.current;
              const delay = ctx ? Math.max(0, nextStartTimeRef.current - ctx.currentTime) : 0;
              setTimeout(() => {
                playbackCtxRef.current = null;
                nextStartTimeRef.current = 0;
                setMicLocked(false);
              }, delay * 1000 + 150);
            }
          } catch {
            // ignore malformed JSON
          }
        } else if (event.data instanceof Blob) {
          if (!playbackCtxRef.current) {
            playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
            nextStartTimeRef.current = 0;
          }
          const buf = await event.data.arrayBuffer();
          scheduleChunk(buf);
        }
      };
      ws.onerror = () => { setError("WebSocket error"); setPhase("setup"); };
      ws.onclose = () => { setPhase((p) => p !== "ended" ? "ended" : p); };
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

    if (totalLen < sampleRate * 0.8) {
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
          <div className="flex flex-col items-center py-12 gap-8">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 border-4 border-gray-700 rounded-full" />
              <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">📞</div>
            </div>

            <div className="text-center space-y-1">
              <p className="text-xl font-medium text-white">{SETUP_STEPS[setupStep]}</p>
              <p className="text-sm text-gray-500">This takes a moment to ensure a realistic simulation</p>
            </div>

            <div className="flex gap-2">
              {SETUP_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i <= setupStep ? "w-6 bg-blue-500" : "w-1.5 bg-gray-600"
                  }`}
                />
              ))}
            </div>

            <div className="bg-gray-800 rounded-xl p-5 w-full border border-gray-700/50">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Your Scenario</p>
              <div className="space-y-2.5">
                {[
                  ["Prospect", formatLabel(form.prospect_role)],
                  ["Industry", formatLabel(form.industry)],
                  ["Mood", formatLabel(form.mood)],
                  ["Objection", formatLabel(form.objection_type)],
                  ["Deal Stage", formatLabel(form.deal_stage)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-white font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
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

            {brief && (
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setIntelOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-200 hover:text-white transition-colors"
                >
                  <span>🎯 Prospect Intel</span>
                  <span className="text-gray-500 text-xs">{intelOpen ? "hide ▲" : "show ▼"}</span>
                </button>
                {intelOpen && (
                  <div className="px-4 pb-4 space-y-3">
                    {(brief.prospect_name || brief.prospect_company) && (
                      <div className="flex items-center gap-3 pb-2 border-b border-gray-700">
                        <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {brief.prospect_name ? brief.prospect_name.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{brief.prospect_name}</p>
                          <p className="text-xs text-gray-400">
                            {formatLabel(brief.scenario_params.prospect_role || "")}
                            {brief.prospect_company ? ` · ${brief.prospect_company}` : ""}
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {INTEL_SIGNALS.map(({ label, key }) => (
                        <div key={key} className="bg-gray-700/60 rounded-lg p-2.5">
                          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                          <p className={`text-xs font-semibold ${signalColor(key, brief.scenario_params[key])}`}>
                            {formatLabel(brief.scenario_params[key] || "—")}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                href={sessionIdRef.current ? `/history/${sessionIdRef.current}` : "/review"}
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
