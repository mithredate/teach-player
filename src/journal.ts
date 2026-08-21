import { PRINTABLE_CLASS } from "./sanitize.ts";

// ADR 0017: the browser-facing report channel. Whitelist over blacklist, matching sanitizeInject —
// the frame shape and every character in it must be exactly what we expect, or the whole entry is dropped.
const EVENTS = new Set(["page-open", "form-submit", "report"]);
const ONLY_WHITELIST = new RegExp(`^[${PRINTABLE_CLASS}]*$`, "u");
const CAP = 10_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildJournalEntry(frame: unknown, ts: Date): string | null {
  if (!isPlainObject(frame)) return null;
  if (typeof frame.event !== "string" || !EVENTS.has(frame.event)) return null;
  if (typeof frame.page !== "string") return null;
  if (!isPlainObject(frame.data)) return null;

  const entry = JSON.stringify({ ts: ts.toISOString(), type: frame.event, page: frame.page, data: frame.data });
  if (entry.length > CAP) return null;
  // ADR 0017 §3: drop, never strip — stripping a character out of already-serialized JSON would corrupt it.
  if (!ONLY_WHITELIST.test(entry)) return null;
  return entry;
}
