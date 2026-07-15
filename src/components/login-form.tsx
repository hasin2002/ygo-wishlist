"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { clearPersistedQueryCache } from "@/trpc/client";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: signInError } = await authClient.signIn.username({
      password,
      rememberMe: true,
      username,
    });

    if (signInError) {
      setError("Username or password is incorrect. Try again.");
      setPending(false);
      return;
    }

    clearPersistedQueryCache();
    window.location.assign(nextPath);
  }

  return (
    <form className="mt-9 space-y-5" onSubmit={submit}>
      <label className="block">
        <span className="text-sm font-bold text-zinc-800">Username</span>
        <input
          autoComplete="username"
          className="mt-2 h-12 w-full rounded-xl border border-zinc-300 bg-white/90 px-4 text-base text-zinc-950 shadow-sm outline-none transition-[border-color,box-shadow,background-color] duration-200 hover:border-zinc-400 focus:border-[#8a1f2d] focus:bg-white focus:ring-4 focus:ring-[#8a1f2d]/10 disabled:cursor-wait disabled:bg-zinc-100"
          disabled={pending}
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-zinc-800">Password</span>
        <span className="relative mt-2 block">
          <input
            autoComplete="current-password"
            className="h-12 w-full rounded-xl border border-zinc-300 bg-white/90 px-4 pr-12 text-base text-zinc-950 shadow-sm outline-none transition-[border-color,box-shadow,background-color] duration-200 hover:border-zinc-400 focus:border-[#8a1f2d] focus:bg-white focus:ring-4 focus:ring-[#8a1f2d]/10 disabled:cursor-wait disabled:bg-zinc-100"
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded-lg text-zinc-500 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-wait"
            disabled={pending}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-5 text-rose-900" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#8a1f2d] px-4 text-sm font-black text-white shadow-[0_10px_24px_rgba(138,31,45,0.2)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[#711826] hover:shadow-[0_12px_28px_rgba(138,31,45,0.28)] active:translate-y-px disabled:cursor-wait disabled:opacity-60 disabled:shadow-none"
        disabled={pending}
        type="submit"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
