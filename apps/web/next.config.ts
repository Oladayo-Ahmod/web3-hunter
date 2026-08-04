import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@web3-hunter/ui", "@web3-hunter/db", "@web3-hunter/shared"],
  eslint: {
    // Linting runs explicitly via `pnpm lint` (turbo, root eslint.config.mjs,
    // includes the Next.js rules for this app) — running Next's own
    // build-time ESLint pass on top would be redundant and can't find that
    // config anyway, since it doesn't resolve a flat config living outside
    // this app's directory.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
