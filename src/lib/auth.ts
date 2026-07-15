import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { db } from "@/db";
import {
  accounts,
  authRateLimits,
  sessions,
  users,
  verifications,
} from "@/db/schema";

export const auth = betterAuth({
  appName: "Yu-Gi-Oh! Wishlist",
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      account: accounts,
      rateLimit: authRateLimits,
      session: sessions,
      user: users,
      verification: verifications,
    },
    transaction: true,
  }),
  disabledPaths: ["/sign-up/email", "/is-username-available"],
  emailAndPassword: {
    disableSignUp: true,
    enabled: true,
    maxPasswordLength: 128,
    minPasswordLength: 12,
  },
  plugins: [
    username({
      maxUsernameLength: 40,
      minUsernameLength: 3,
    }),
  ],
  rateLimit: {
    customRules: {
      "/sign-in/username": {
        max: 5,
        window: 60,
      },
    },
    storage: "database",
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      publicCollection: {
        defaultValue: false,
        input: false,
        required: false,
        type: "boolean",
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
