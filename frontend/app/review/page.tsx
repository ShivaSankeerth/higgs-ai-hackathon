"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getConversation,
  analyzeConversation,
  type ConversationLog,
} from "@/lib/api";

export default function ReviewPage() {
  const [conversation, setConversation] = useState<ConversationLog[] | null>(
    null
  );
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversation = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getConversation();
      setConversation(data.data);
    } catch {
      setError(
        "No conversation found. Complete a practice call first."
      );
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await analyzeConversation();
      setAnalysis(data.summary);
    } catch {
      setError("Failed to analyze conversation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">
          &larr; Home
        </Link>
        <h1 className="text-lg font-semibold">Review &amp; Coach</h1>
        <div className="w-16" />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm">
            {error}
          </div>
        )}

        {!conversation ? (
          <div className="text-center py-20 space-y-6">
            <h2 className="text-2xl font-bold">Review Your Call</h2>
            <p className="text-gray-400">
              Load your most recent practice call to see the transcript and get
              AI coaching.
            </p>
            <button
              onClick={loadConversation}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 px-6 py-3 rounded-xl font-medium transition-colors"
            >
              {loading ? "Loading..." : "Load Last Call"}
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold">Call Transcript</h2>
            <div className="bg-gray-800 rounded-xl p-4 max-h-[400px] overflow-y-auto space-y-3">
              {conversation.map((log, i) => (
                <div
                  key={i}
                  className={`flex ${log.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      log.role === "user" ? "bg-blue-600" : "bg-gray-700"
                    }`}
                  >
                    <div className="text-xs text-gray-400 mb-1">
                      {log.role === "user" ? "You (Sales Rep)" : "Prospect"}
                    </div>
                    {log.transcription}
                  </div>
                </div>
              ))}
            </div>

            {!analysis ? (
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-3 rounded-xl font-medium transition-colors"
              >
                {loading ? "Analyzing..." : "Get AI Coaching Feedback"}
              </button>
            ) : (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">Coaching Feedback</h2>
                <div className="bg-gray-800 rounded-xl p-6 prose prose-invert max-w-none">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {analysis}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <Link
                href="/simulate"
                className="flex-1 text-center bg-blue-600 hover:bg-blue-700 py-3 rounded-xl font-medium transition-colors"
              >
                Practice Again
              </Link>
              <button
                onClick={() => {
                  setConversation(null);
                  setAnalysis(null);
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded-xl font-medium transition-colors"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
