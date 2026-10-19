import type { NextConfig } from "next";

/**
 * Short links for printed material: SHORT_LINKS="pvr=q_AbC123,cafe=q_XyZ789" makes /pvr land
 * on the QR code /q/q_AbC123. Config redirects run before the auth proxy, so a diner with no
 * account reaches the guest surface, and the token stays the only thing that grants a table.
 * Read at build time, which is fine: changing a link is a deploy.
 */
function shortLinks(): { source: string; destination: string; permanent: false }[] {
  return (process.env["SHORT_LINKS"] ?? "")
    .split(",")
    .map((pair) => pair.trim().split("="))
    .filter(
      (pair): pair is [string, string] =>
        pair.length === 2 && /^[a-z0-9-]+$/.test(pair[0] ?? "") && /^q_[A-Za-z0-9]+$/.test(pair[1] ?? ""),
    )
    .map(([slug, token]) => ({ source: `/${slug}`, destination: `/q/${token}`, permanent: false }));
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  async redirects() {
    return shortLinks();
  },
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
