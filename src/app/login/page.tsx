import { ArrowLeft, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AnimatedCardWall } from "@/components/animated-card-wall";
import { LoginForm } from "@/components/login-form";
import { getCurrentSession } from "@/server/session";

const privatePaths = new Set(["/assign-chase", "/spend", "/wheel"]);

export const metadata: Metadata = {
  title: "Sign in | Yu-Gi-Oh! Wishlist",
  description: "Sign in to manage your private card collection.",
};

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
    <main className="min-h-dvh bg-[#f6f4ef] text-zinc-950 lg:grid lg:grid-cols-[minmax(26rem,0.86fr)_minmax(0,1.14fr)]">
      <section className="relative flex min-h-[calc(100dvh-11rem)] items-center justify-center overflow-hidden px-5 py-10 sm:min-h-[calc(100dvh-14rem)] sm:px-10 sm:py-14 lg:min-h-dvh lg:px-12 xl:px-16">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(138,31,45,0.08),transparent_30%),radial-gradient(circle_at_82%_78%,rgba(24,24,27,0.06),transparent_34%)]"
        />

        <div className="relative w-full max-w-md">
          <Link
            className="group inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-bold text-zinc-600 transition-colors hover:text-[#8a1f2d]"
            href="/"
          >
            <ArrowLeft
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
            />
            Public tracker
          </Link>

          <div className="mt-10 sm:mt-14">
            <div className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.16em] text-[#8a1f2d]">
              <span className="grid size-9 place-items-center rounded-lg border border-[#8a1f2d]/15 bg-[#8a1f2d]/8 shadow-sm">
                <LockKeyhole aria-hidden="true" className="size-4" />
              </span>
              Owner access
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-[-0.04em] sm:text-5xl">
              Welcome back.
            </h1>
            <p className="mt-3 max-w-sm text-base font-medium leading-7 text-zinc-600">
              Sign in to manage your private collection and keep your next pickup
              in sight.
            </p>
          </div>

          <LoginForm nextPath={nextPath} />

          <p className="mt-8 border-t border-zinc-300/80 pt-5 text-xs font-semibold leading-5 text-zinc-500">
            Your collection details stay private to your account.
          </p>
        </div>
      </section>

      <aside
        aria-label="A moving wall of collectible cards"
        className="relative h-44 overflow-hidden border-b border-black/10 bg-[#0b0b10] shadow-[0_18px_60px_rgba(0,0,0,0.18)] sm:h-56 lg:sticky lg:top-0 lg:h-dvh lg:min-h-[40rem] lg:border-b-0 lg:border-l lg:border-white/10"
      >
        <AnimatedCardWall className="h-full" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(11,11,16,0.08),transparent_40%,rgba(11,11,16,0.76)),linear-gradient(90deg,rgba(11,11,16,0.38),transparent_24%)]"
        />
        <div className="absolute inset-x-8 bottom-8 hidden max-w-lg text-white lg:block xl:inset-x-12 xl:bottom-12">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/65">
            The collection wall
          </p>
          <p className="mt-3 text-2xl font-black leading-tight tracking-[-0.03em] xl:text-3xl">
            Built for the cards you&apos;re chasing.
          </p>
        </div>
      </aside>
    </main>
  );
}
