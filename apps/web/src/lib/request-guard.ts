import {
  allowed,
  forbiddenHost,
  forbiddenOrigin,
  isAllowedLoopbackHost,
  isAllowedLoopbackOrigin,
  isJsonMediaType,
  parseHostHeader,
  unsupportedMediaType,
  type GuardResult,
} from "@visual-system/local-security";

export interface DashboardRequest {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  contentType: string | null;
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The port the dashboard actually listens on. The Avalok CLI passes it explicitly; `next dev`
 * and `next start` also publish the bound port (after any fallback) as `PORT`.
 */
export function dashboardPort(environment: Record<string, string | undefined> = process.env) {
  const port = Number(environment.AVALOK_DASHBOARD_PORT || environment.PORT);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined;
}

/**
 * Centralized browser-abuse checks for every dashboard request (pages, assets, and `/api/*`).
 * See docs/security/local-http.md for the threat model.
 *
 * 1. Host must be a loopback name on the dashboard's port (DNS rebinding protection for
 *    sensitive reads such as repository analysis and Codex sessions).
 * 2. A present Origin must be this same loopback server; `null` and foreign origins are rejected
 *    on every method, so the server refuses cross-origin use rather than relying on CORS.
 *    Missing Origin is allowed: browsers always send Origin on POST, so only non-browser local
 *    clients (the CLI, curl, scripts) omit it, and they are not the browser threat.
 * 3. API mutations must be JSON, which a cross-origin page cannot send without a preflight.
 */
export function guardDashboardRequest(
  request: DashboardRequest,
  expectedPort: number | undefined,
): GuardResult {
  if (!isAllowedLoopbackHost(request.host, { port: expectedPort })) return forbiddenHost;
  if (request.origin !== null) {
    // With an unknown listening port, the validated Host names the port the browser connected to.
    const port = expectedPort ?? parseHostHeader(request.host)?.port ?? 80;
    if (!isAllowedLoopbackOrigin(request.origin, { port })) return forbiddenOrigin;
  }
  const api = request.pathname === "/api" || request.pathname.startsWith("/api/");
  if (
    api &&
    !safeMethods.has(request.method.toUpperCase()) &&
    !isJsonMediaType(request.contentType)
  )
    return unsupportedMediaType("application/json");
  return allowed;
}
