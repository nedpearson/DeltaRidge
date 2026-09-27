export default function MissionPage() {
  return (
    <div className="flex flex-col h-full bg-slate-900 text-white min-h-screen">
      <header className="p-4 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold text-blue-400">CURRENT MISSION</h1>
        <p className="text-sm text-slate-300">Oak Hills Storm Response</p>
      </header>
      
      <main className="flex-1 p-6 flex flex-col gap-6">
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">Next Property</h2>
          <div className="mb-4">
            <p className="text-2xl font-bold">123 Oak Hills Dr</p>
            <p className="text-slate-400">0.2 miles away</p>
          </div>
          
          <div className="bg-slate-900 rounded p-4 mb-6 border border-slate-700">
            <h3 className="text-sm font-medium text-slate-400 mb-1">Why this house:</h3>
            <p className="text-sm">Roof is ~16 years old. Nearby recent hail damage reported.</p>
          </div>

          <div className="flex flex-col gap-3">
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded shadow text-lg">
              Navigate
            </button>
            <button className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 px-4 rounded shadow border border-slate-600 text-lg">
              Open
            </button>
            <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-4 rounded shadow text-lg">
              Knocked
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
