export interface RequestAuth {
  token: string | null;
  source: "authorization" | "authtoken" | null;
}

function parseBearer(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [scheme, ...rest] = value.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer" || rest.length === 0) {
    return null;
  }

  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export function parseRequestAuth(request: Request): RequestAuth {
  const authorization = request.headers.get("Authorization");
  const bearer = parseBearer(authorization);
  if (bearer) {
    return { token: bearer, source: "authorization" };
  }

  const fallback = request.headers.get("AUTHTOKEN");
  if (fallback) {
    const token = fallback.trim();
    if (token.length > 0) {
      return { token, source: "authtoken" };
    }
  }

  return { token: null, source: null };
}
