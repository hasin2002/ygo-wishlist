import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { RecordsDataProvider } from "@/components/records/records-preview-provider";
import { protectedLoginHref } from "@/server/protected-login";

export const runtime = "nodejs";

export default async function RecordsLayout({ children }: { children: React.ReactNode }) {
  const localPreviewReview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1" &&
    (await headers()).get("x-records-test-live") !== "1";
  // This dynamic import keeps the resettable browser-preview harness fully
  // detached from the configured database. The test-only header above lets
  // Playwright prove the normal protected-route redirect using the same server.
  const session = localPreviewReview
    ? null
    : await (await import("@/server/session")).getCurrentSession();

  if (!session && !localPreviewReview) {
    redirect(await protectedLoginHref("/records"));
  }

  return (
    <RecordsDataProvider initiallyAuthenticated={Boolean(session)}>
      {children}
    </RecordsDataProvider>
  );
}
