"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  getSessionDetail,
  getSessionAnalysis,
  type SessionDetail,
  type CallAnalysis,
  type DimensionScore,
  type ImprovementPoint,
} from "@/lib/api";

const ACRONYMS = new Set(["cfo", "cto", "ceo", "vp", "hr", "it"]);

function formatLabel(s: string): string {
  return s
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Shared review UI ──────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 10) * circumference;
  const color = score >= 7 ? "#22c55e" : score >= 5 ? "#eab308" : "#ef4444";
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#374151" strokeWidth="10" />
      <circle cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${filled} ${circumference}`} strokeLinecap="round"
        transform="rotate(-90 70 70)" style={{ transition: "stroke-dasharray 0.8s ease" }} />
      <text x="70" y="65" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="30" fontWeight="bold">
        {score.toFixed(1)}
      </text>
      <text x="70" y="88" textAnchor="middle" fill="#9ca3af" fontSize="11">out of 10</text>
    </svg>
  );
}

function DimensionCard({ dim }: { dim: DimensionScore }) {
  const barColor = dim.score >= 7 ? "bg-green-500" : dim.score >= 5 ? "bg-yellow-500" : "bg-red-500";
  const textColor = dim.score >= 7 ? "text-green-400" : dim.score >= 5 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">{dim.name}</span>
        <span className={`text-lg font-bold ${textColor}`}>{dim.score}<span className="text-xs text-gray-500 font-normal">/10</span></span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${dim.score * 10}%`, transition: "width 0.6s ease" }} />
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{dim.feedback}</p>
    </div>
  );
}

function ImprovementCard({ item }: { item: ImprovementPoint }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex gap-3">
      <span className="mt-0.5 text-orange-400 flex-shrink-0">⚠</span>
      <div>
        <span className="text-xs font-semibold text-orange-400 uppercase tracking-wide">{item.dimension}</span>
        <p className="text-sm text-gray-300 mt-1 leading-relaxed">{item.point}</p>
      </div>
    </div>
  );
}

function HighlightCard({ text }: { text: string }) {
  return (
    <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4 flex gap-3">
      <span className="text-green-400 flex-shrink-0">✓</span>
      <p className="text-sm text-gray-300 leading-relaxed">{text}</p>
    </div>
  );
}

function AnalysisPanel({ analysis }: { analysis: CallAnalysis }) {
  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-2xl p-6 flex flex-col items-center gap-2">
        <p className="text-sm text-gray-400 uppercase tracking-widest font-medium">Overall Score</p>
        <ScoreRing score={analysis.overall_score} />
        <p className="text-gray-500 text-xs">Based on 6 dimensions</p>
      </div>
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Dimension Breakdown</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {analysis.dimensions.map((dim) => <DimensionCard key={dim.name} dim={dim} />)}
        </div>
      </div>
      {analysis.improvements.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Areas to Improve</h2>
          <div className="space-y-3">
            {analysis.improvements.map((item, i) => <ImprovementCard key={i} item={item} />)}
          </div>
        </div>
      )}
      {analysis.highlights.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">What You Did Well</h2>
          <div className="space-y-3">
            {analysis.highlights.map((text, i) => <HighlightCard key={i} text={text} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sessionId = parseInt(id, 10);

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [analysis, setAnalysis] = useState<CallAnalysis | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSessionDetail(sessionId)
      .then((d) => {
        setDetail(d);
        if (d.analysis) setAnalysis(d.analysis);
      })
      .catch(() => setError("Session not found."))
      .finally(() => setLoadingDetail(false));
  }, [sessionId]);

  const runAnalysis = async () => {
    setError(null);
    setLoadingAnalysis(true);
    try {
      const res = await getSessionAnalysis(sessionId);
      setAnalysis(res.analysis);
    } catch {
      setError("Failed to analyze session. Try again.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <Link href="/history" className="text-gray-400 hover:text-white text-sm">&larr; History</Link>
        <h1 className="text-lg font-semibold">Session Review</h1>
        <div className="w-16" />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm">{error}</div>
        )}

        {loadingDetail && (
          <div className="text-center py-20 text-gray-400 animate-pulse">Loading session...</div>
        )}

        {detail && (
          <>
            {/* Session metadata */}
            <div className="bg-gray-800 rounded-xl p-5 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[
                ["Prospect", formatLabel(detail.session.prospect_role)],
                ["Industry", formatLabel(detail.session.industry)],
                ["Deal Stage", formatLabel(detail.session.deal_stage)],
                ["Mood", formatLabel(detail.session.mood)],
                ["Objection", formatLabel(detail.session.objection_type)],
                ["Date", formatDate(detail.session.created_at)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">{label}</div>
                  <div className="text-gray-200">{value}</div>
                </div>
              ))}
            </div>

            {/* Transcript */}
            {detail.turns.length > 0 && (
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setTranscriptOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  <span>Call Transcript ({Math.floor(detail.turns.length / 2)} exchanges)</span>
                  <span className="text-gray-500">{transcriptOpen ? "▲" : "▼"}</span>
                </button>
                {transcriptOpen && (
                  <div className="px-4 pb-4 max-h-80 overflow-y-auto space-y-3">
                    {detail.turns.map((turn, i) => (
                      <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${turn.role === "user" ? "bg-blue-600" : "bg-gray-700"}`}>
                          <div className="text-xs text-gray-400 mb-1">
                            {turn.role === "user" ? "You (Sales Rep)" : "Prospect"}
                          </div>
                          {turn.transcription}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Analysis */}
            {!analysis ? (
              <button
                onClick={runAnalysis}
                disabled={loadingAnalysis || detail.turns.length === 0}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loadingAnalysis ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing performance...
                  </>
                ) : detail.turns.length === 0 ? (
                  "No turns to analyze"
                ) : (
                  "Get AI Coaching Feedback"
                )}
              </button>
            ) : (
              <AnalysisPanel analysis={analysis} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
