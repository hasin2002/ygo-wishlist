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
    <form className="mt-8 space-y-5" onSubmit={submit}>
      <label className="block">
        <span className="text-sm font-bold text-zinc-800">Username</span>
        <input
          autoComplete="username"
          className="mt-1 h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20"
          disabled={pending}
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-zinc-800">Password</span>
        <span className="relative mt-1 block">
          <input
            autoComplete="current-password"
            className="h-12 w-full rounded-md border border-zinc-300 bg-white px-3 pr-12 text-base text-zinc-950 outline-none transition focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20"
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
            disabled={pending}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white transition hover:bg-[#711826] disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
