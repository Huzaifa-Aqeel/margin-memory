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
