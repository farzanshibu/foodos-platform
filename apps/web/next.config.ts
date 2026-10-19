import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Only the icons actually used ship to the browser, not the whole set.
  experimental: { optimizePackageImports: ["lucide-react"] },
  transpilePackages: [
    "@foodos/registry",
    "@foodos/contracts",
    "@foodos/core",
    "@foodos/transport",
    "@foodos/auth",
    "@foodos/billing",
    "@foodos/ui",
  ],
};

export default nextConfig;
