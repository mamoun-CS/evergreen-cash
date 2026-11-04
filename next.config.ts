import type { NextConfig } from "next";

const nativeBuild = process.env.BUILD_TARGET === "native";

const nextConfig: NextConfig = {
  cacheComponents: !nativeBuild,
  partialPrefetching: !nativeBuild,
  ...(nativeBuild ? {
    output: "export" as const,
    trailingSlash: true,
    images: { unoptimized: true },
  } : {}),
};

export default nextConfig;
