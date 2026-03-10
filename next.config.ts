import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@hocuspocus/server"],
  async rewrites() {
    return [
      {
        source: "/api/canvas/:path*",
        destination: "http://localhost:1235/api/canvas/:path*",
      },
    ];
  },
};

export default nextConfig;
