import type { RuntimeConfig } from "../config";

export interface BangumiRequestOptions {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export interface BangumiSuccess {
  ok: true;
  status: number;
  data: unknown;
  location?: string;
}

export interface BangumiFailure {
  ok: false;
  status?: number;
  message: string;
  details?: unknown;
}

export type BangumiResult = BangumiSuccess | BangumiFailure;

function isJsonContentType(value: string | null): boolean {
  return value !== null && value.toLowerCase().includes("json");
}

function toQueryString(
  query: Record<string, string | number | boolean | null | undefined> | undefined,
): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

function toDetails(bodyText: string, contentType: string | null): unknown {
  if (!bodyText) {
    return null;
  }

  if (isJsonContentType(contentType)) {
    return JSON.parse(bodyText);
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export async function requestBangumi(
  config: RuntimeConfig,
  token: string | null,
  options: BangumiRequestOptions,
): Promise<BangumiResult> {
  const url = `${config.apiBaseUrl}${options.path}${toQueryString(options.query)}`;
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": config.userAgent,
  });

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const init: RequestInit = {
    method: options.method,
    headers,
    redirect: "manual",
  };

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return {
      ok: false,
      message: `Failed to reach Bangumi API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (response.status === 204) {
    return { ok: true, status: response.status, data: null };
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (!location) {
      return {
        ok: false,
        status: response.status,
        message: `Bangumi returned redirect ${response.status} without a Location header.`,
      };
    }
    return { ok: true, status: response.status, data: null, location };
  }

  const contentType = response.headers.get("Content-Type");
  const bodyText = await response.text();
  const details = bodyText ? toDetails(bodyText, contentType) : null;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: `Bangumi API request failed with ${response.status} ${response.statusText}`,
      details,
    };
  }

  if (!bodyText) {
    return { ok: true, status: response.status, data: null };
  }

  if (isJsonContentType(contentType)) {
    return {
      ok: true,
      status: response.status,
      data: details,
    };
  }

  return {
    ok: true,
    status: response.status,
    data: details ?? bodyText,
  };
}

export function formatBangumiFailure(result: BangumiResult): string {
  if (result.ok) {
    return "Unexpected Bangumi success response.";
  }

  if (result.details === undefined || result.details === null) {
    return result.message;
  }

  if (typeof result.details === "string") {
    return `${result.message}: ${result.details}`;
  }

  return `${result.message}: ${JSON.stringify(result.details, null, 2)}`;
}
