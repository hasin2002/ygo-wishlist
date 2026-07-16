import { redirect } from "next/navigation";
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

  return children;
}
