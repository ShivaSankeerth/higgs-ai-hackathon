"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  fetchParams,
  submitForm,
  createWebSocket,
  type ScenarioParams,
  type FormData,
} from "@/lib/api";

type Phase = "setup" | "connecting" | "live" | "ended";

function formatLabel(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  const [transcript, setTranscript] = useState<
    { role: string; text: string }[]
  >([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  const handleStart = async () => {
    setError(null);
    setPhase("connecting");
    try {
      await submitForm(form);
      const ws = createWebSocket();
      wsRef.current = ws;

      ws.onopen = () => setPhase("live");
      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
          playAudio(event.data);
        }
      };
      ws.onerror = () => {
        setError("WebSocket error");
        setPhase("setup");
      };
      ws.onclose = () => {
        if (phase !== "ended") setPhase("ended");
      };
    } catch {
      setError("Failed to start simulation");
      setPhase("setup");
    }
  };

  const playAudio = useCallback(async (blob: Blob) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer =
        await audioContextRef.current.decodeAudioData(arrayBuffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (err) {
      console.error("Error playing audio:", err);
    }
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ data: base64 }));
            setTranscript((prev) => [
              ...prev,
              { role: "user", text: "[Audio sent - awaiting response...]" },
            ]);
          }
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setError("Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const endCall = () => {
    if (wsRef.current) {
      wsRef.current.send("close");
      wsRef.current.close();
    }
    setPhase("ended");
  };

  if (!params) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        {error ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <Link href="/" className="text-blue-400 underline">
              Back home
            </Link>
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
        <Link href="/" className="text-gray-400 hover:text-white text-sm">
          &larr; Home
        </Link>
        <h1 className="text-lg font-semibold">Practice Call</h1>
        <div className="w-16" />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {phase === "setup" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Configure Your Scenario</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  key: "prospect_role" as const,
                  label: "Prospect Role",
                  options: params.user.prospect.prospect_role,
                },
                {
                  key: "industry" as const,
                  label: "Industry",
                  options: params.user.prospect.industry,
                },
                {
                  key: "mood" as const,
                  label: "Prospect Mood",
                  options: params.user.prospect.mood,
                },
                {
                  key: "gender" as const,
                  label: "Prospect Gender",
                  options: params.user.prospect.gender,
                },
                {
                  key: "objection_type" as const,
                  label: "Objection Type",
                  options: params.user.deal.objection_type,
                },
                {
                  key: "deal_stage" as const,
                  label: "Deal Stage",
                  options: params.user.deal.deal_stage,
                },
              ].map(({ key, label, options }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-400 mb-1">
                    {label}
                  </label>
                  <select
                    value={form[key]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {formatLabel(opt)}
                      </option>
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
            <div className="animate-pulse text-xl">
              Setting up your scenario...
            </div>
            <p className="text-gray-400 mt-2">
              Generating prospect persona and connecting
            </p>
          </div>
        )}

        {phase === "live" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400 font-medium">
                  Call in progress
                </span>
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
                  Press and hold the mic button to speak to the prospect
                </p>
              ) : (
                <div className="space-y-3">
                  {transcript.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          msg.role === "user"
                            ? "bg-blue-600"
                            : "bg-gray-700"
                        }`}
                      >
                        <div className="text-xs text-gray-400 mb-1">
                          {msg.role === "user" ? "You" : "Prospect"}
                        </div>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-center">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all ${
                  isRecording
                    ? "bg-red-500 scale-110 shadow-lg shadow-red-500/50"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
              >
                🎤
              </button>
            </div>
            <p className="text-center text-gray-500 text-sm">
              Hold to record, release to send
            </p>
          </div>
        )}

        {phase === "ended" && (
          <div className="text-center py-20 space-y-6">
            <h2 className="text-2xl font-bold">Call Ended</h2>
            <p className="text-gray-400">
              Great practice! Review your performance or start another call.
            </p>
            <div className="flex gap-4 justify-center">
              <Link
                href="/review"
                className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Review &amp; Get Coaching
              </Link>
              <button
                onClick={() => {
                  setPhase("setup");
                  setTranscript([]);
                }}
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
