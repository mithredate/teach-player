# TODO

Progress tracker — the *only* place state lives. Detail stays in the orchestrator repo: `docs/05-build-plan.md` and `docs/adr/`. Check items off as they finish; record loose ends under Notes.

- [x] **Step 1 — Scaffold** (done 2026-08-20): package.json (bin, engines >=22, exact pins), pnpm-workspace.yaml (ADR 0009), tsconfig, MIT license, README stub, CI workflow
- [x] **Step 2 — Terminal-only milestone** (done 2026-08-20): PTY spawn with `[command…]` passthrough (ADR 0007), ws on 127.0.0.1:7529 (ADR 0006), replay buffer (ADR 0003), takeover (ADR 0002), xterm.js client
- [x] **Step 3 — Content pane** (done 2026-08-20): static serving + traversal guard, `sandbox="allow-scripts"`, bridge-script injection (ADR 0005), `/api/files`, picker
- [x] **Step 4 — Watcher** (done 2026-08-20): recursive fs.watch → debounced fsevent frames, iframe auto-reload (cache-busted), picker refresh with "● " badge on new files
- [x] **Step 5 — The bridge** (done 2026-08-20): whitelist sanitizer + `[lesson] ` prefix + `\r` (ADR 0005, TDD, `src/sanitize.ts`), `window.teachPlayer.send()` bridge API, send-selection button via injected helper
- [ ] **Content-pane rework — two-origin scoped serve** (ADR 0015, decided 2026-08-21): serve only `<workspace>/public/` (fail loudly if missing) on a **second port 7530**, real origin, iframe `sandbox="allow-scripts allow-same-origin"`; iframe `src` → `http://127.0.0.1:7530/<path-under-public>`. Full web platform + real storage in the pane; private siblings unreachable. Keep sanitizer + `[lesson]` prefix + bridge unchanged. Load-bearing (each needs a functional test): (a) shell `message` handler also requires `event.origin === "http://127.0.0.1:7530"` and posts to the iframe with that explicit target origin, not `"*"`; (b) ws-origin whitelist rejects `Origin: http://127.0.0.1:7530`. Watcher + `/api/files` scope to `public/`. Expand the workspace MIME map for framework assets (`.mjs`, `.wasm`, `.map`, `.woff`/`.woff2`, `.ttf`, `.ico`, `.webmanifest`, `.txt`, `.xml`).
- [ ] **Step 6 — Polish + publish**: README (GIF, security sentence incl. the `public/`-read residual per ADR 0015, node-gyp note, npx), error paths, npm trusted publishing with provenance (ADR 0011)

## Notes / loose ends

- Agent-initiated clipboard (OSC 52) added 2026-08-20 via `@xterm/addon-clipboard` 0.2.0 — needs a manual check that Claude Code's copy now lands in the clipboard. Known harmless overlap: selecting in the TUI may write the clipboard twice (our select-handler + the agent's OSC 52 write).
- Typechecking restored 2026-08-20 (ADR 0014, orchestrator repo): `tsc --noEmit` runs inside `pnpm test`; `@types/node` pinned to the 22.x line to match the engine floor.
- `pnpm install` needs a `postinstall` chmod: pnpm strips the exec bit from node-pty's prebuilt `spawn-helper` (ADR 0013). README contributor note still pending (step 6).
- Acceptance still manual: real `claude` session in a browser (plan mode, colors, resize artifacts), `claude --resume` picker, and the xterm client itself. Chrome automation is blocked by org policy on this machine, so nothing verified the client end to end yet.
- Step 3 manual acceptance pending (Mehrdad): open the German-B1 workspace, check `mock/ut1.html` renders with its `../assets/` styles and the self-grading quiz working inside the sandboxed iframe, picker defaults to newest. Note: `sandbox="allow-scripts"` lessons lose localStorage/cookies by design (ADR 0005).
- Step 4 manual acceptance pending (Mehrdad): ask the agent to edit the open lesson — the pane should refresh within a second; a new lesson should appear in the picker with a `● ` badge.
- Step 5 manual acceptance pending (Mehrdad): select a quiz score in a legacy mock exam, click "Send selection", watch the agent respond — no keyboard involved. The button says "Send selection" (not "…to Claude" as the build plan sketched) to stay agent-agnostic (ADR 0007).
- `teach-player` linked globally 2026-08-20 (`pnpm link` → `~/Library/pnpm/bin`, symlink to this repo's `dist/server.js`, rebuilds picked up automatically). Gotcha: `pnpm link` errors with "global bin directory not in PATH" *after* creating the link when the shell hasn't re-sourced `~/.zshrc` post-`pnpm setup` — open a new terminal.
- Resize control frames have no automated test (manual tier per ADR 0010). The fake agent could report `process.stdout.columns` on demand if that changes.
- Step 3 adds real routes; the server's whitelist map (`/`, `/main.js`, `/main.css`) is where they go.
- `listLessons` uses bare `statSync`: a broken symlink in the workspace throws inside the request handler and kills the server. Fold into step 6 (error paths) — a try/continue in the walk.
