import { WheelApp } from "@/components/wheel-app";
import { getCurrentSession } from "@/server/session";
import { redirect } from "next/navigation";

export default async function WheelPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login?next=/wheel");
  }

  return <WheelApp />;
}
