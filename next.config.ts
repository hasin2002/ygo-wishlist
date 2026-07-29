import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    ...(process.env.RECORDS_BROWSER_TEST === "1" ? ["127.0.0.1"] : []),
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.io",
    "*.trycloudflare.com",
  ],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
