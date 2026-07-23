"use client";

import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  usernameClient,
} from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";
import { getAuthClientFetchHeaders } from "@/lib/auth-hosts";

export const authClient = createAuthClient({
  fetchOptions: {
    headers: getAuthClientFetchHeaders(
      typeof window === "undefined" ? undefined : window.location.hostname,
    ),
  },
  plugins: [usernameClient(), inferAdditionalFields<typeof auth>()],
});

export const { useSession } = authClient;
