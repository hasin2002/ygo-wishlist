import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/session";
import { protectedLoginHref } from "@/server/protected-login";

export const runtime = "nodejs";

export default async function EbayLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) {
    redirect(await protectedLoginHref("/ebay"));
  }
  if (session.user.role !== "admin") {
    redirect("/");
  }
  return children;
}
