import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, USER_ID_HEADER, verifySession } from "@/lib/auth";

// Protects /dashboard and all /api/* except /api/auth/* and /api/health, see docs/BUILD-PLAN.md
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip any client-supplied x-user-id before it can reach a route handler
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(USER_ID_HEADER);

  if (pathname.startsWith("/api/auth/") || pathname === "/api/health") {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? verifySession(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  requestHeaders.set(USER_ID_HEADER, session.userId);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
