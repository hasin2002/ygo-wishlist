import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/session";

export const runtime = "nodejs";

export default async function EbayLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?next=/ebay");
  }
  if (session.user.role !== "admin") {
    redirect("/");
  }
  return children;
}
