import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The dev server binds 0.0.0.0 and calls itself localhost. Browsers that
  // open 127.0.0.1 are otherwise blocked from the dev socket, so the page
  // stays as static HTML and never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  devIndicators: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/**": ["./data/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
