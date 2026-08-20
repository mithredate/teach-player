# teach-player

Watch an AI coding agent teach, in your browser. One pane shows the live agent terminal. The other pane shows the lesson content the agent writes.

> **Status: under construction.** Not on npm yet. This README grows with the tool.

## Planned quickstart

```sh
npx teach-player <workspace-dir> [agent-command...]
```

The agent command defaults to `claude`. Any agent CLI works the same way.

**Note:** the first install compiles a native module (`node-pty`). You need Xcode Command Line Tools on macOS, or `build-essential` on Linux.

## Security

Treat opening a workspace like running its code. The server binds to `127.0.0.1` only.

## License

MIT
