/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const nextConfig = {
  output: 'export',
  // GitHub Pages usually hosts at /repository-name/
  basePath: isProd ? '/news-pusher' : '',
  assetPrefix: isProd ? '/news-pusher' : '',
  images: {
    unoptimized: true,
  },
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
