// ADR 0005 / 0001: security-load-bearing — whitelist, never a blacklist, so an
// escape sequence or control character nobody has thought of still can't get through.
// ADR 0017 §3: journal.ts shares this exact class — reports are checked against the same whitelist.
export const PRINTABLE_CLASS = "\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\p{Zs}";
const PRINTABLE = new RegExp(`[${PRINTABLE_CLASS}]`, "gu");
const CAP = 10_000;

export function sanitizeInject(text: string): string {
  const kept = (text.match(PRINTABLE) ?? []).slice(0, CAP).join(""); // cap in code points — never splits an emoji's surrogate pair
  return `[lesson] ${kept}\r`; // prefix and trailing \r are ours, unconditionally
}
