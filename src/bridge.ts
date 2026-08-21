// teach-player bridge (ADR 0005/0017) — injected into every served lesson page. Since ADR
// 0015/0016 the iframe runs on the real content origin with allow-same-origin (no longer
// opaque-origin); postMessage still targets "*" because the parent picker validates
// source+origin, and the server sanitizes what actually lands.
declare global {
  interface Window {
    teachPlayer: { send(text: string): void; report(data: object): void };
  }
}

// ADR 0017: pure and exported so it's unit-testable without a browser — see test/unit/bridge.test.js.
// File uploads aren't JSON-safe, so only string-valued FormData entries survive into the report.
export function submitToReport(entries: Iterable<[string, unknown]>, formId: string, page: string) {
  const fields: Record<string, string> = {};
  for (const [key, value] of entries) if (typeof value === "string") fields[key] = value;
  return { type: "report" as const, event: "form-submit" as const, page, data: { form: formId, fields } };
}

// DOM wiring only runs in a browser — this module is bundled as an IIFE for injection, and
// also doubles as the import target for the unit test above, where none of these globals exist.
if (typeof document !== "undefined") {
  window.teachPlayer = {
    send(text: string) {
      parent.postMessage({ type: "inject", text: String(text) }, "*");
    },
    // ADR 0017: queued channel — costs nothing until the agent reads the journal. No coercion:
    // data passes through untouched, the server is the real validator.
    report(data: object) {
      parent.postMessage({ type: "report", event: "report", page: location.pathname, data }, "*");
    },
  };

  addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type === "get-selection") window.teachPlayer.send(String(document.getSelection()));
  });

  // ADR 0017 auto-capture #1: the bridge is injected at the end of body, so this fires once per
  // page load — the last page-open entry in the journal *is* the current page.
  parent.postMessage({ type: "report", event: "page-open", page: location.pathname, data: { title: document.title } }, "*");

  // ADR 0017 auto-capture #2: capture phase so this still fires when the lesson's own handler
  // stops propagation or the form navigates away. Never preventDefault — passive observation only.
  addEventListener(
    "submit",
    (event) => {
      const form = event.target as HTMLFormElement;
      parent.postMessage(submitToReport(new FormData(form).entries(), form.id, location.pathname), "*");
    },
    true,
  );
}

export {};
