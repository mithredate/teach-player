# TODO

Progress tracker — the *only* place state lives. Detail stays in the orchestrator repo: `docs/05-build-plan.md` and `docs/adr/`. Check items off as they finish; record loose ends under Notes.

- [x] **Step 1 — Scaffold** (done 2026-08-20): package.json (bin, engines >=22, exact pins), pnpm-workspace.yaml (ADR 0009), tsconfig, MIT license, README stub, CI workflow
- [x] **Step 2 — Terminal-only milestone** (done 2026-08-20): PTY spawn with `[command…]` passthrough (ADR 0007), ws on 127.0.0.1:7529 (ADR 0006), replay buffer (ADR 0003), takeover (ADR 0002), xterm.js client
- [ ] **Step 3 — Content pane**: static serving + traversal guard, `sandbox="allow-scripts"`, bridge-script injection (ADR 0005), `/api/files`, picker
- [ ] **Step 4 — Watcher**: recursive fs.watch → fsevent frames, iframe auto-reload, picker refresh
- [ ] **Step 5 — The bridge**: whitelist sanitizer + `[lesson]` prefix (ADR 0005, TDD), send-selection via injected helper
- [ ] **Step 6 — Polish + publish**: README (GIF, security sentence, node-gyp note, npx), error paths, npm trusted publishing with provenance (ADR 0011)

## Notes / loose ends

- Agent-initiated clipboard (OSC 52) added 2026-08-20 via `@xterm/addon-clipboard` 0.2.0 — needs a manual check that Claude Code's copy now lands in the clipboard. Known harmless overlap: selecting in the TUI may write the clipboard twice (our select-handler + the agent's OSC 52 write).
- Typechecking restored 2026-08-20 (ADR 0014, orchestrator repo): `tsc --noEmit` runs inside `pnpm test`; `@types/node` pinned to the 22.x line to match the engine floor.
- `pnpm install` needs a `postinstall` chmod: pnpm strips the exec bit from node-pty's prebuilt `spawn-helper` (ADR 0013). README contributor note still pending (step 6).
- Acceptance still manual: real `claude` session in a browser (plan mode, colors, resize artifacts), `claude --resume` picker, and the xterm client itself. Chrome automation is blocked by org policy on this machine, so nothing verified the client end to end yet.
- Resize control frames have no automated test (manual tier per ADR 0010). The fake agent could report `process.stdout.columns` on demand if that changes.
- Step 3 adds real routes; the server's whitelist map (`/`, `/main.js`, `/main.css`) is where they go.
