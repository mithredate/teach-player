#!/usr/bin/env node
// Stands in for `claude` (ADR 0010): a real process on a real PTY, so no server code is faked.
process.stdin.setRawMode?.(true); // no terminal echo, so tests only see what this script prints
process.stdin.setEncoding("utf8");
process.stdout.write("\x1b[32mfake-agent ready\x1b[0m\r\n");

process.stdin.on("data", (chunk) => {
  if (chunk.includes("\x03")) process.exit(0); // Ctrl-C
  process.stdout.write(`echo:${chunk.replace(/[\r\n]/g, "")}\r\n`);
});
