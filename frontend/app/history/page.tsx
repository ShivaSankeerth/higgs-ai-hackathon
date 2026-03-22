"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { listSessions, type SessionSummary } from "@/lib/api";

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: SessionSummary["status"] }) {
  const styles: Record<string, string> = {
    completed: "bg-green-900/50 text-green-400 border-green-700/50",
    in_progress: "bg-yellow-900/50 text-yellow-400 border-yellow-700/50",
    abandoned: "bg-gray-700/50 text-gray-400 border-gray-600/50",
  };
  const labels: Record<string, string> = {
    completed: "Completed",
    in_progress: "In Progress",
    abandoned: "Abandoned",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status] ?? styles.abandoned}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSessions()
      .then((res) => setSessions(res.sessions))
      .catch(() => setError("Could not load session history."));
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">&larr; Home</Link>
        <h1 className="text-lg font-semibold">Session History</h1>
        <div className="w-16" />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-6 text-sm">{error}</div>
        )}

        {sessions === null && !error && (
          <div className="text-center py-20 text-gray-400 animate-pulse">Loading sessions...</div>
        )}

        {sessions?.length === 0 && (
          <div className="text-center py-20 space-y-4">
            <p className="text-gray-500">No sessions yet.</p>
            <Link href="/simulate" className="text-blue-400 hover:text-blue-300 text-sm underline">
              Start your first practice call
            </Link>
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <div className="space-y-3">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/history/${s.id}`}
                className="block bg-gray-800 border border-gray-700 hover:border-gray-500 rounded-xl p-5 transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-white group-hover:text-blue-400 transition-colors">
                        {formatLabel(s.prospect_role)}
                      </span>
                      <span className="text-gray-500 text-sm">·</span>
                      <span className="text-gray-400 text-sm">{formatLabel(s.industry)}</span>
                      <StatusBadge status={s.status} />
                      {s.has_analysis === 1 && (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-purple-900/50 text-purple-400 border-purple-700/50">
                          Analyzed
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
                      <span>{formatLabel(s.deal_stage)}</span>
                      <span>{formatLabel(s.mood)} mood</span>
                      <span>{Math.floor(s.turn_count / 2)} exchange{Math.floor(s.turn_count / 2) !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                    {formatDate(s.created_at)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
