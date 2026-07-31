import { getCurrentSession } from "@/server/session";
import { redirect } from "next/navigation";
import { protectedLoginHref } from "@/server/protected-login";

export const runtime = "nodejs";

export default async function SpendPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect(await protectedLoginHref("/spend"));
  }

  redirect("/records");
}
