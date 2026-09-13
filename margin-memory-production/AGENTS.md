# Repository guidance

- Keep all code TypeScript/TSX; do not introduce a Python service.
- Keep the Strands agent server-side.
- The agent chooses what to investigate; deterministic TypeScript calculates financial/labor facts.
- Do not expose `OPENAI_API_KEY` or any Supabase service-role key to the browser.
- Preserve Supabase RLS as the primary tenant authorization boundary.
- New multi-table business mutations should be transactional Postgres RPCs and `SECURITY INVOKER` unless there is a documented reason otherwise.
- Only confirmed lessons are trusted semantic memory.
- Every quantitative preflight finding must retain explicit completed-job evidence.
- Do not turn chat into the primary UI. The primary artifact is the evidence-backed Preflight.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
