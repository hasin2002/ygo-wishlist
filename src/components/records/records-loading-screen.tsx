export function RecordsContentLoading() {
  return (
    <div
      aria-label="Loading records"
      className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white"
      role="status"
    >
      <p className="text-sm font-bold text-zinc-500">Opening Records…</p>
    </div>
  );
}
