import { format } from "node:util";

// Gated by the DEBUG env var (set in the root dev script) so verbose
// tracing (territory/scoreboard updates, photo metadata/moderation) stays
// quiet by default and opt-in during local development.
//
// Writes directly to process.stdout rather than console.debug: this repo's
// Next.js build patches console.* methods to also mirror them into
// .next/dev/logs/next-development.log (see
// node_modules/next/dist/server/node-environment-extensions/console-file.js),
// and in practice console.debug output from server rendering wasn't
// reliably reaching the visible terminal (only that log file) -- writing to
// stdout directly sidesteps whatever is swallowing it there.
export function debugLog(...args: unknown[]): void {
  if (!process.env.DEBUG) return;
  process.stdout.write(`${format(...args)}\n`);
}
