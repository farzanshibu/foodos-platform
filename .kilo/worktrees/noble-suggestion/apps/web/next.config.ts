import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
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
