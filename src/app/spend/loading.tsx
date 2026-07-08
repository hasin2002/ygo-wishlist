export default function SpendLoading() {
  return (
    <main className="min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="border-b border-zinc-300/80 pb-5">
          <div className="h-4 w-36 rounded bg-zinc-200" />
          <div className="mt-3 h-10 w-72 rounded bg-zinc-200" />
        </header>
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm"
                  key={index}
                >
                  <div className="h-3 w-24 rounded bg-zinc-200" />
                  <div className="mt-5 h-8 w-28 rounded bg-zinc-200" />
                  <div className="mt-3 h-4 w-36 rounded bg-zinc-100" />
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
              <div className="h-5 w-40 rounded bg-zinc-200" />
              <div className="mt-5 grid gap-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="h-10 rounded bg-zinc-100" key={index} />
                ))}
              </div>
            </div>
          </div>
          <aside className="h-fit rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
            <div className="h-5 w-28 rounded bg-zinc-200" />
            <div className="mt-5 grid gap-3">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="h-16 rounded bg-zinc-100" key={index} />
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
