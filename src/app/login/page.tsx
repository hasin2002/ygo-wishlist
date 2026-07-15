import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentSession } from "@/server/session";

const privatePaths = new Set(["/assign-chase", "/spend", "/wheel"]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);
  const nextPath = privatePaths.has(params.next ?? "") ? params.next! : "/";

  if (session) {
    redirect(nextPath);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f6f4ef] px-4 py-8 text-zinc-950">
      <section className="w-full max-w-md rounded-xl border border-zinc-300 bg-white p-6 shadow-lg sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
          Owner access
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-600">
          Sign in to manage your private collection.
        </p>
        <LoginForm nextPath={nextPath} />
        <Link
          className="mt-6 inline-flex text-sm font-bold text-[#8a1f2d] transition hover:text-[#711826]"
          href="/"
        >
          Back to the public tracker
        </Link>
      </section>
    </main>
  );
}
