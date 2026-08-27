import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WebSR se importa dinámicamente en el cliente; no necesita SSR.
  // Vercel serve static files from /public for the weight JSONs.
};

export default nextConfig;
