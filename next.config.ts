import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The sample downloads are read from their committed paths at request time;
  // listed here so the deployment's trace carries them. Keep in step with
  // lib/sampleFiles.ts.
  outputFileTracingIncludes: {
    "/api/samples/[file]": ["./evals/documents/pdf/sample-price-list.pdf", "./pipeline/data/members.csv", "./pipeline/data/contracts.csv", "./pipeline/data/checkins.csv"],
  },
};

export default nextConfig;
