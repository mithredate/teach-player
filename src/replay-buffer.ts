// ADR 0003: every new client starts with a blank terminal, so the server keeps the tail
// of the PTY output and replays it. A cut mid-escape-sequence may garble one repaint.
export function createReplayBuffer(limitBytes: number) {
  let bytes = Buffer.alloc(0);
  return {
    add(chunk: Buffer) {
      bytes = Buffer.concat([bytes, chunk]).subarray(-limitBytes);
    },
    replay() {
      return bytes;
    },
  };
}
