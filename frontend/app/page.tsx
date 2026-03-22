import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      <div className="max-w-3xl mx-auto text-center px-6">
        <h1 className="text-5xl font-bold mb-4">Sales Training Simulator</h1>
        <p className="text-xl text-gray-300 mb-2">
          The batting cage for sales reps.
        </p>
        <p className="text-gray-400 mb-12 max-w-xl mx-auto">
          Practice against AI-powered prospects. Get scored. Improve before it
          matters.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <Link
            href="/simulate"
            className="group block p-8 bg-gray-800 border border-gray-700 rounded-2xl hover:border-blue-500 transition-all"
          >
            <div className="text-3xl mb-4">🎙️</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">
              Practice Call
            </h2>
            <p className="text-gray-400 text-sm">
              Voice roleplay with an AI prospect. Choose your scenario, handle
              objections, close the deal.
            </p>
          </Link>

          <Link
            href="/review"
            className="group block p-8 bg-gray-800 border border-gray-700 rounded-2xl hover:border-green-500 transition-all"
          >
            <div className="text-3xl mb-4">📊</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-green-400 transition-colors">
              Review &amp; Coach
            </h2>
            <p className="text-gray-400 text-sm">
              Get AI-powered scoring and coaching feedback on your practice
              calls.
            </p>
          </Link>
          <Link
            href="/history"
            className="group block p-8 bg-gray-800 border border-gray-700 rounded-2xl hover:border-purple-500 transition-all"
          >
            <div className="text-3xl mb-4">📋</div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-purple-400 transition-colors">
              Session History
            </h2>
            <p className="text-gray-400 text-sm">
              Browse past practice calls and run coaching analysis on any session.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
