// teach-player bridge (ADR 0005) — runs inside the sandboxed, opaque-origin lesson
// iframe, so every postMessage targets "*"; the server sanitizes what actually lands.
declare global {
  interface Window {
    teachPlayer: { send(text: string): void };
  }
}

window.teachPlayer = {
  send(text: string) {
    parent.postMessage({ type: "inject", text: String(text) }, "*");
  },
};

addEventListener("message", (event: MessageEvent) => {
  if (event.data?.type === "get-selection") window.teachPlayer.send(String(document.getSelection()));
});

export {};
