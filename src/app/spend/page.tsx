import { getCurrentSession } from "@/server/session";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default async function SpendPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login?next=/spend");
  }

  redirect("/records");
}
