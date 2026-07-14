import { timingSafeEqual } from "node:crypto";
import { TOKEN_HEADER } from "./state.ts";

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export const HttpStatus = {
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  MisdirectedRequest: 421,
} as const;

export const ErrorCode = {
  InvalidHost: "invalid_host",
  CrossOriginDenied: "cross_origin_denied",
  MissingToken: "missing_token",
  UpgradeFailed: "upgrade_failed",
  MethodNotAllowed: "method_not_allowed",
  NotFound: "not_found",
  BadRequest: "bad_request",
  // An app iframe tried to call a tool its server never declared app-visible
  // (SEP-1865 _meta.ui.visibility). See daemon/apps/visibility.ts.
  AppToolNotVisible: "app_tool_not_visible",
} as const;

function parseHostnameFromHeader(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const colonIndex = hostHeader.lastIndexOf(":");
  const rawHost = colonIndex === -1 ? hostHeader : hostHeader.slice(0, colonIndex);
  const stripped = rawHost.replace(/^\[|\]$/g, "");
  return stripped.toLowerCase();
}

export function isAllowedHost(hostHeader: string | null): boolean {
  const hostname = parseHostnameFromHeader(hostHeader);
  return hostname !== null && ALLOWED_HOSTNAMES.has(hostname);
}

export function originMatchesHost(
  originHeader: string | null,
  hostHeader: string | null,
): boolean {
  if (originHeader === null) return true;
  if (hostHeader === null) return false;
  try {
    const originUrl = new URL(originHeader);
    return originUrl.host.toLowerCase() === hostHeader.toLowerCase();
  } catch {
    return false;
  }
}

function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(
  status: number,
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message: string,
): Response {
  return jsonResponse({ error: code, message }, status);
}

export type GuardOutcome =
  | { allowed: true }
  | { allowed: false; response: Response };

export function guardRequest(request: Request, serverToken: string): GuardOutcome {
  const hostHeader = request.headers.get("host");
  const originHeader = request.headers.get("origin");

  if (!isAllowedHost(hostHeader)) {
    return {
      allowed: false,
      response: errorResponse(
        HttpStatus.MisdirectedRequest,
        ErrorCode.InvalidHost,
        "Host header must resolve to localhost",
      ),
    };
  }

  if (!originMatchesHost(originHeader, hostHeader)) {
    return {
      allowed: false,
      response: errorResponse(
        HttpStatus.Forbidden,
        ErrorCode.CrossOriginDenied,
        "Origin does not match Host",
      ),
    };
  }

  const isMutating = !SAFE_METHODS.has(request.method);
  if (isMutating && !tokensMatch(request.headers.get(TOKEN_HEADER), serverToken)) {
    return {
      allowed: false,
      response: errorResponse(
        HttpStatus.Unauthorized,
        ErrorCode.MissingToken,
        "X-Canvas-Token header missing or invalid",
      ),
    };
  }

  return { allowed: true };
}
