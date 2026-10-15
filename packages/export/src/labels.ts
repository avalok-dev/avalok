import type { Entity } from "@visual-system/schema";

// Privacy rules for anything that leaves the dashboard as an image, page or message. Entity names
// are shown (a recap without service names is useless) but never raw paths, secret-looking tokens,
// run titles, prompts, or anything else a user did not choose to share. Callers show the result
// to the user in a preview before it is saved.

const secretLike =
  /^(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
// Hex and base64 runs are redacted from 32 characters. Hyphen/underscore tokens (base64url keys)
// only from 40 and only when they look random (a digit and an uppercase letter), so ordinary
// kebab-case service names such as "research-platform-backend-worker" survive.
const base64Run = /^[A-Za-z0-9+/=]{32,}$/;
const base64UrlKey = /^(?=.*\d)(?=.*[A-Z])[A-Za-z0-9_-]{40,}$/;
const longToken = { test: (text: string) => base64Run.test(text) || base64UrlKey.test(text) };
const urlWithCredentials = /:\/\/[^/\s:@]+:[^/\s@]+@/;

/** A label that is safe to put in a shared image: no paths, no secret-looking values, bounded. */
export function safeLabel(name: string, maximum = 28) {
  let label = name.trim().replace(/\s+/g, " ");
  if (!label) return "(unnamed)";
  // Credentials and well-known secret formats are checked on the whole text first.
  if (secretLike.test(label) || urlWithCredentials.test(label)) return "[redacted]";
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(label);
  if (isUrl) {
    // A URL keeps only its host.
    label = label.match(/^[a-z][a-z0-9+.-]*:\/\/([^/\s?#]+)/i)![1]!.replace(/^[^@]*@/, "");
  } else if (/[\\/]/.test(label)) {
    // Paths reveal the machine and the user; keep only the last segment.
    label =
      label
        .split(/[\\/]+/)
        .filter(Boolean)
        .at(-1) ?? "(path)";
  }
  // A long unbroken token is probably a key or hash, whatever it was embedded in.
  if (longToken.test(label) || secretLike.test(label)) return "[redacted]";
  return label.length > maximum ? `${label.slice(0, maximum - 1)}…` : label;
}

const kindNames: Partial<Record<Entity["kind"], string>> = {
  vector_database: "Vector DB",
  mcp_server: "MCP server",
  load_balancer: "Load balancer",
};

export function kindLabel(kind: Entity["kind"]) {
  return kindNames[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("_", " ");
}

/**
 * Display labels for entities. With `anonymize`, names are replaced by "<Kind> <n>" in a stable
 * order (by id), so the shape of the system can be shared without naming anything.
 */
export function entityLabels(entities: readonly Entity[], anonymize: boolean) {
  const labels = new Map<string, string>();
  if (!anonymize) {
    for (const entity of entities) labels.set(entity.id, safeLabel(entity.name));
    return labels;
  }
  const counts = new Map<string, number>();
  for (const entity of [...entities].sort((a, b) => a.id.localeCompare(b.id))) {
    const next = (counts.get(entity.kind) ?? 0) + 1;
    counts.set(entity.kind, next);
    labels.set(entity.id, `${kindLabel(entity.kind)} ${next}`);
  }
  return labels;
}

export function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
