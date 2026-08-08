import { Suspense } from "react";
import { ViewDbEntriesClient } from "./view-db-entries-client";

function ViewerLoading() {
  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto grid min-h-72 w-full max-w-7xl place-items-center rounded-lg border border-zinc-300 bg-white font-bold text-zinc-600" role="status">
        Loading Record cards…
      </div>
    </main>
  );
}

export default async function ViewDbEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const query = await searchParams;
  const recordId = typeof query.record === "string" ? query.record : null;

  return (
    <Suspense fallback={<ViewerLoading />}>
      <ViewDbEntriesClient recordId={recordId} />
    </Suspense>
  );
}
