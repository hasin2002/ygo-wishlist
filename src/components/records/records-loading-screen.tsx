export function RecordsLoadingScreen() {
  return (
    <main
      aria-label="Loading records"
      className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6"
      role="status"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <div className="space-y-3 rounded-lg border border-zinc-300 bg-white p-5 shadow-sm">
          <div className="h-4 w-36 animate-pulse rounded bg-zinc-200" />
          <div className="h-8 w-28 animate-pulse rounded bg-zinc-200" />
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-300 bg-zinc-100 p-1">
          <div className="h-11 animate-pulse rounded bg-white" />
          <div className="h-11 animate-pulse rounded bg-white" />
          <div className="h-11 animate-pulse rounded bg-white" />
        </div>
        <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white">
          <p className="text-sm font-bold text-zinc-500">Opening Records…</p>
        </div>
      </div>
    </main>
  );
}
