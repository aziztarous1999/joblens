import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root: a stray package-lock.json higher up (e.g. in the user folder)
  // would otherwise make Next.js guess the wrong root.
  turbopack: { root: process.cwd() },
  // No floating Next.js badge in the UI (cleaner demos and screenshots).
  devIndicators: false,
};

export default nextConfig;
