import { config } from "zod";

// Imported first by main.tsx, before any schema is created: zod decides at
// schema creation whether to compile fast parsers with `new Function`, and
// probes for it, which the page's Content-Security-Policy (no eval) reports
// as a violation. The main thread only reads small files, so the
// interpreter is fast enough. The worker keeps the default.
config({ jitless: true });
