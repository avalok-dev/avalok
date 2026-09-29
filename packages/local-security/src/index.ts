/**
 * Loopback request validation shared by the dashboard and the OTLP/Claude receiver.
 *
 * Binding to 127.0.0.1 keeps other machines out, but not web pages running in the user's own
 * browser: a page can send simple cross-origin requests to loopback ports, and DNS rebinding can
 * make a foreign hostname resolve to 127.0.0.1. Every browser-controlled header is therefore
 * parsed strictly against an allowlist. There are no substring checks, so hosts such as
 * `localhost.attacker.example` or `127.0.0.1.attacker.example` never match.
 *
 * Pure functions only (no Node APIs), so the Next.js middleware can use them too.
 */

/** The loopback hostnames Sarvadrik answers to. IPv6 is only the canonical `::1`. */
export const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);

export interface ParsedAuthority {
  /** Lower-cased hostname without IPv6 brackets. */
  hostname: string;
  /** Explicit port, or `undefined` when the authority omits it. */
  port: number | undefined;
}

// A reg-name/IPv4 host or a bracketed IPv6 literal, then an optional port. Userinfo (`a@b`),
// paths, whitespace, and anything else are rejected rather than normalized.
const authorityPattern = /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9.-]+))(?::(\d{1,5}))?$/;

function parsePort(value: string | undefined) {
  if (value === undefined) return { ok: true as const, port: undefined };
  const port = Number(value);
  return port >= 1 && port <= 65_535
    ? { ok: true as const, port }
    : { ok: false as const, port: undefined };
}

/** Parses a `Host` header value (`host[:port]`). Returns `undefined` when it is malformed. */
export function parseHostHeader(value: string | null | undefined): ParsedAuthority | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 262) return undefined;
  const match = authorityPattern.exec(value);
  if (!match) return undefined;
  const port = parsePort(match[3]);
  if (!port.ok) return undefined;
  const hostname = (match[1] ?? match[2] ?? "").toLowerCase();
  if (!hostname) return undefined;
  return { hostname, port: port.port };
}

export interface ParsedOrigin extends ParsedAuthority {
  scheme: "http" | "https";
}

const originPattern = /^(https?):\/\/([^/?#\s]+)$/;

/**
 * Parses a serialized `Origin` header. `"null"` (sandboxed frames, `file:` pages, some
 * redirects) and every other non-tuple origin return `undefined`, i.e. they are never trusted.
 */
export function parseOrigin(value: string | null | undefined): ParsedOrigin | undefined {
  if (typeof value !== "string" || value.length > 300) return undefined;
  const match = originPattern.exec(value);
  if (!match) return undefined;
  const authority = parseHostHeader(match[2]);
  if (!authority) return undefined;
  return { scheme: match[1] as "http" | "https", ...authority };
}

const effectivePort = (authority: ParsedAuthority, scheme: "http" | "https" = "http") =>
  authority.port ?? (scheme === "https" ? 443 : 80);

export interface LoopbackHostOptions {
  /** The port the server actually listens on. Omit only when the port cannot be known. */
  port?: number | undefined;
}

/** True when a `Host` header names this loopback server (and its actual port, when known). */
export function isAllowedLoopbackHost(
  value: string | null | undefined,
  options: LoopbackHostOptions = {},
) {
  const host = parseHostHeader(value);
  if (!host || !LOOPBACK_HOSTNAMES.has(host.hostname)) return false;
  return options.port === undefined || effectivePort(host) === options.port;
}

export interface LoopbackOriginOptions {
  /**
   * `number`: the origin must be this exact loopback server (same port). `"any"`: any loopback
   * port is acceptable. There is deliberately no default.
   */
  port: number | "any";
}

/** True when an `Origin` header is a plain-HTTP loopback origin (and the given port). */
export function isAllowedLoopbackOrigin(
  value: string | null | undefined,
  options: LoopbackOriginOptions,
) {
  const origin = parseOrigin(value);
  // Sarvadrik only serves plain HTTP on loopback; an https loopback origin is another server.
  if (!origin || origin.scheme !== "http" || !LOOPBACK_HOSTNAMES.has(origin.hostname)) return false;
  return options.port === "any" || effectivePort(origin) === options.port;
}

/** The lower-cased media type without parameters (`application/json; charset=utf-8` → `application/json`). */
export function mediaType(contentType: string | null | undefined) {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * JSON is not a CORS-safelisted request content type, so a cross-origin browser page cannot
 * send it without a preflight, which Sarvadrik never approves.
 */
export function isJsonMediaType(contentType: string | null | undefined) {
  return mediaType(contentType) === "application/json";
}

export interface GuardRejection {
  ok: false;
  status: 403 | 415;
  error: string;
}

export type GuardResult = { ok: true } | GuardRejection;

export const allowed: GuardResult = { ok: true };

export const forbiddenHost: GuardRejection = {
  ok: false,
  status: 403,
  error: "Forbidden: Sarvadrik only accepts requests addressed to its loopback host.",
};

export const forbiddenOrigin: GuardRejection = {
  ok: false,
  status: 403,
  error: "Forbidden: cross-origin requests are not accepted.",
};

export function unsupportedMediaType(expected: string): GuardRejection {
  return { ok: false, status: 415, error: `Unsupported Content-Type. Expected ${expected}.` };
}
