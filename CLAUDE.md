# teach-player

Public repo. Plans and ADRs live in the private `teach-player-orchestrator` repo (`../teach-player-orchestrator/docs/adr/`); follow them, and propose a new ADR there before deviating.

**"cook"** = read `TODO.md`, do the first unchecked item, check it off, jot loose ends there.

## Rules

- Ponytail everything — laziest solution that works; use the `dev:ponytail` skill when coding.
- Tests on `node:test`: TDD where design is discovered, DAMP over DRY, custom fakes over mocks, public API only. Tiers: unit / integration / functional (ADR 0010).
- Deps: exact pins via pnpm, verify latest stable against the registry first (ADR 0009). Security: whitelist over blacklist.
- Agent-agnostic: `claude` is the default command, Codex must work identically (ADR 0007).
- Commit per build step, conventional commits, clean history — this repo goes public.
- Delegate tasks to Opus or Sonnet agents when possible to keep Fable quota.
- On every modification here: document the change in the orchestrator repo, commit, and push both repos.

## Communication

- Write like ASD-STE100: short sentences, active voice, one idea per sentence, simple words.
- Be concise. Show a code example instead of a wall of text when possible.
