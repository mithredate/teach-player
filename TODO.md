# TODO

Progress tracker — the *only* place state lives. Detail stays in the orchestrator repo: `docs/05-build-plan.md` and `docs/adr/`. Check items off as they finish; record loose ends under Notes.

- [x] **Step 1 — Scaffold** (done 2026-08-20): package.json (bin, engines >=22, exact pins), pnpm-workspace.yaml (ADR 0009), tsconfig, MIT license, README stub, CI workflow
- [ ] **Step 2 — Terminal-only milestone**: PTY spawn with `[command…]` passthrough (ADR 0007), ws on 127.0.0.1:7529 (ADR 0006), replay buffer (ADR 0003), takeover (ADR 0002), xterm.js client
- [ ] **Step 3 — Content pane**: static serving + traversal guard, `sandbox="allow-scripts"`, bridge-script injection (ADR 0005), `/api/files`, picker
- [ ] **Step 4 — Watcher**: recursive fs.watch → fsevent frames, iframe auto-reload, picker refresh
- [ ] **Step 5 — The bridge**: whitelist sanitizer + `[lesson]` prefix (ADR 0005, TDD), send-selection via injected helper
- [ ] **Step 6 — Polish + publish**: README (GIF, security sentence, node-gyp note, npx), error paths, npm trusted publishing with provenance (ADR 0011)

## Notes / loose ends

- `src/server.ts` is a stub so `pnpm build` has real input; step 2 replaces it.
- `test/smoke.test.js` only guards manifest invariants; real test tiers (unit/integration/functional dirs) arrive with step 2.
- No GitHub remote yet — create the public repo and push when ready.
