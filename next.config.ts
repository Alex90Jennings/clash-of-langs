import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  outputFileTracingExcludes: { "*": ["bench/**", "worker/**", "docs/**"] },
};

export default nextConfig;
