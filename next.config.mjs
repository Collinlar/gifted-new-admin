/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  pageExtensions: ["tsx", "ts", "jsx", "js"],
};

export default nextConfig;
