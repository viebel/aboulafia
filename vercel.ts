import { type VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project configuration.
 *
 * Next.js is detected automatically — this file is here mostly so that
 * future routing, caching, or cron additions land in one place.
 *
 * Docs: https://vercel.com/docs/project-configuration/vercel-ts
 */
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "npm run build",
  installCommand: "npm install",
  devCommand: "npm run dev",
};
