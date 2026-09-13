import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The build journey page was /evals before it was named Our Journey; old links still land.
  redirects() {
    return [{ source: "/evals", destination: "/our-journey", permanent: false }];
  },
};

export default nextConfig;
