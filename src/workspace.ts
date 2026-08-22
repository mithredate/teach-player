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

// /_tp/files (ADR 0021): every file under root, recursive, dotfile segments and node_modules
// excluded, sorted A→Z by full path. No extension filter — the tree shows everything.
export function listFiles(root: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      // A broken symlink's target doesn't exist — skip it instead of throwing and killing the server.
      const stat = statSync(full, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) walk(full);
      else files.push(relative(root, full).split(sep).join("/"));
    }
  }
  walk(root);

  return files.sort();
}
