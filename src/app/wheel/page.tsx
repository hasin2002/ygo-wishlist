import { WheelApp } from "@/components/wheel-app";
import { getCurrentSession } from "@/server/session";
import { redirect } from "next/navigation";
import { protectedLoginHref } from "@/server/protected-login";

export default async function WheelPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect(await protectedLoginHref("/wheel"));
  }

  return <WheelApp />;
}
