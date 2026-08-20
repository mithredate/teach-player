// ADR 0005 / 0001: security-load-bearing — whitelist, never a blacklist, so an
// escape sequence or control character nobody has thought of still can't get through.
const PRINTABLE = /[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu;
const CAP = 10_000;

export function sanitizeInject(text: string): string {
  const kept = (text.match(PRINTABLE) ?? []).slice(0, CAP).join(""); // cap in code points — never splits an emoji's surrogate pair
  return `[lesson] ${kept}\r`; // prefix and trailing \r are ours, unconditionally
}
