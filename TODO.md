# TODO

Progress tracker — the *only* place state lives. Detail stays in the orchestrator repo: `docs/05-build-plan.md` and `docs/adr/`. Check items off as they finish; record loose ends under Notes.

- [x] **Step 1 — Scaffold** (done 2026-08-20): package.json (bin, engines >=22, exact pins), pnpm-workspace.yaml (ADR 0009), tsconfig, MIT license, README stub, CI workflow
- [x] **Step 2 — Terminal-only milestone** (done 2026-08-20): PTY spawn with `[command…]` passthrough (ADR 0007), ws on 127.0.0.1:7529 (ADR 0006), replay buffer (ADR 0003), takeover (ADR 0002), xterm.js client
- [x] **Step 3 — Content pane** (done 2026-08-20): static serving + traversal guard, `sandbox="allow-scripts"`, bridge-script injection (ADR 0005), `/api/files`, picker
- [x] **Step 4 — Watcher** (done 2026-08-20): recursive fs.watch → debounced fsevent frames, iframe auto-reload (cache-busted), picker refresh with "● " badge on new files
- [x] **Step 5 — The bridge** (done 2026-08-20): whitelist sanitizer + `[lesson] ` prefix + `\r` (ADR 0005, TDD, `src/sanitize.ts`), `window.teachPlayer.send()` bridge API, send-selection button via injected helper
- [ ] **Terminal-native rebuild** (ADR 0016, decided 2026-08-21 — folds in ADR 0015; supersedes the old "content-pane rework" item):
  - **Terminal:** PTY passthrough in the user's terminal — raw-mode stdin → pty, pty output → stdout, `SIGWINCH` → `pty.resize`, restore terminal + exit with agent's code on pty exit. Delete: xterm client (`src/client/main.ts` terminal half), `@xterm/*` deps, `replay-buffer.ts`, takeover, resize control frames, browser clipboard handling.
  - **Control server** (picker page + `/api/files` + ws): bind port 0. No takeover — broadcast fsevents to all connected tabs, accept injects from any. ws origin whitelist (ADR 0012) derived from the actually-bound port. Print + auto-open the URL.
  - **Content server:** serve only `<workspace>/public/` (mkdir at startup if missing); port = stable hash of resolved workspace path into 20000–29999, fail loudly on bind conflict. Traversal guard rerooted at `public/`; bridge injection unchanged; expand MIME map (`.mjs`, `.wasm`, `.map`, `.woff`/`.woff2`, `.ttf`, `.ico`, `.webmanifest`, `.txt`, `.xml`). Watcher + `/api/files` scope to `public/`.
  - **Iframe:** `sandbox="allow-scripts allow-same-origin"`, `src` → content origin. Load-bearing, each needs a functional test: (a) picker page `message` handler requires `event.source` AND `event.origin === <content origin>`, posts to the iframe with that explicit target origin, never `"*"`; (b) ws whitelist rejects a content-origin `Origin` header.
  - **Hardening one-liners:** `X-Frame-Options: DENY` on picker-page routes; Host-header whitelist on both servers.
  - **Unchanged:** `sanitize.ts` + `[lesson] ` prefix, `bridge.ts`, `workspace.ts` guard logic, watcher debounce.
  - Functional tests can drop `--test-concurrency=1` (no fixed ports left to fight over).
- [ ] **Step 6 — Polish + publish**: README (GIF, security sentence incl. the `public/`-read residual per ADR 0015, node-gyp note, npx), error paths, npm trusted publishing with provenance (ADR 0011)

## Notes / loose ends

- Pre-pivot manual-acceptance notes (steps 2–5, browser terminal) pruned 2026-08-21 — obsolete under ADR 0016. New acceptance after the rebuild: run `teach-player <german-b1>` in a real terminal (plan mode, colors, resize), picker page auto-opens, quiz saves scores in localStorage that survive a restart, "Send selection" lands `[lesson] …` in the terminal, two players from two repos run at once.
- German-B1 workspace needs migrating before acceptance: move `mock/` + `assets/` under `public/` (lesson-internal `../assets/` links keep working — both live under the new root).
- The step-4 note stands: the `.git` functional test asserts an exact fsevent count — loosen to "no .git paths" if CI flakes.
- Typechecking restored 2026-08-20 (ADR 0014, orchestrator repo): `tsc --noEmit` runs inside `pnpm test`; `@types/node` pinned to the 22.x line to match the engine floor.
- `pnpm install` needs a `postinstall` chmod: pnpm strips the exec bit from node-pty's prebuilt `spawn-helper` (ADR 0013). README contributor note still pending (step 6).
- `teach-player` linked globally 2026-08-20 (`pnpm link` → `~/Library/pnpm/bin`, symlink to this repo's `dist/server.js`, rebuilds picked up automatically). Gotcha: `pnpm link` errors with "global bin directory not in PATH" *after* creating the link when the shell hasn't re-sourced `~/.zshrc` post-`pnpm setup` — open a new terminal.
- `listLessons` uses bare `statSync`: a broken symlink in the workspace throws inside the request handler and kills the server. Fold into step 6 (error paths) — a try/continue in the walk.
