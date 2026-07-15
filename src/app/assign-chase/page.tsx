import { AssignChaseApp } from "@/components/assign-chase-app";
import { getCurrentSession } from "@/server/session";
import { redirect } from "next/navigation";

export default async function AssignChasePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login?next=/assign-chase");
  }

  return <AssignChaseApp />;
}
