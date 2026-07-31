import { AssignChaseApp } from "@/components/assign-chase-app";
import { getCurrentSession } from "@/server/session";
import { redirect } from "next/navigation";
import { protectedLoginHref } from "@/server/protected-login";

export default async function AssignChasePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect(await protectedLoginHref("/assign-chase"));
  }

  return <AssignChaseApp />;
}
