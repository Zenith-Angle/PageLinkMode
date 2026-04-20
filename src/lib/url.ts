const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function isSupportedPageUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed !== null && HTTP_PROTOCOLS.has(parsed.protocol);
}

export function normalizePageUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.hash = "";
  return parsed.toString();
}

export function getHostname(rawUrl: string): string {
  return new URL(rawUrl).hostname;
}

export function isSkippableHref(href: string): boolean {
  return href.startsWith("javascript:") || href.startsWith("mailto:");
}

export function isHashOnlyNavigation(currentUrl: string, nextUrl: string): boolean {
  const current = new URL(currentUrl);
  const next = new URL(nextUrl);
  current.hash = "";
  next.hash = "";
  return current.toString() === next.toString();
}

export function buildPermissionPatterns(hostname: string): string[] {
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export function buildPermissionPatternForUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function extractHostnameFromPermissionPattern(pattern: string): string | null {
  if (pattern === "<all_urls>") {
    return "*";
  }

  const matched = pattern.match(/^(?:\*|https?):\/\/([^/]+)\/\*$/i);
  if (!matched) {
    return null;
  }

  return matched[1].toLowerCase();
}
