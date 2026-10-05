import { NextResponse, type NextRequest } from "next/server";
import { dashboardPort, guardDashboardRequest } from "@/lib/request-guard";

export function middleware(request: NextRequest) {
  const result = guardDashboardRequest(
    {
      method: request.method,
      pathname: request.nextUrl.pathname,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      contentType: request.headers.get("content-type"),
    },
    dashboardPort(),
  );
  if (result.ok) return NextResponse.next();
  return NextResponse.json(
    { error: result.error },
    {
      status: result.status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    },
  );
}

// Every request, including pages and static assets: a rebound hostname gets nothing.
export const config = { matcher: "/:path*" };
