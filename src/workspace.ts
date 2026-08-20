import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// ADR 0005 / 0010: security-load-bearing — whitelist check (path stays under root),
// never a blacklist of "..", so an encoding nobody thought of still can't escape.
export function resolveWorkspacePath(root: string, urlPath: string): string | null {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes("\0")) return null;
  if (decoded.split("/").some((segment) => segment === ".git" || segment === "node_modules")) return null;

  const base = resolve(root);
  const candidate = resolve(base, decoded);
  if (candidate !== base && !candidate.startsWith(base + sep)) return null; // escaped root, incl. absolute-path trick

  return candidate;
}

// /api/files: every *.html under root, recursive, newest mtime first.
export function listLessons(root: string): string[] {
  const files: { path: string; mtimeMs: number }[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === ".git" || entry === "node_modules") continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (entry.endsWith(".html")) files.push({ path: relative(root, full).split(sep).join("/"), mtimeMs: stat.mtimeMs });
    }
  }
  walk(root);

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).map((f) => f.path);
}
