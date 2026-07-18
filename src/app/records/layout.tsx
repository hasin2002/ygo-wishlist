import { redirect } from "next/navigation";
import { RecordsDataProvider } from "@/components/records/records-preview-provider";
import { loadRecordsSnapshot } from "@/server/routers/records";
import { getCurrentSession } from "@/server/session";

export const runtime = "nodejs";

export default async function RecordsLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  const localPreviewReview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1";

  if (!session && !localPreviewReview) {
    redirect("/login?next=/records");
  }

  // Send the Records snapshot with the first page response. Previously the client
  // waited to hydrate before starting a second request for this same data.
  const initialSnapshot = session
    ? await loadRecordsSnapshot(session.user.id)
    : undefined;

  return (
    <RecordsDataProvider
      initiallyAuthenticated={Boolean(session)}
      initialSnapshot={initialSnapshot}
    >
      {children}
    </RecordsDataProvider>
  );
}
