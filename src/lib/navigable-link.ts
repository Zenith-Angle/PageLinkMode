import type { NavigableLinkElement } from "./types";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

export function getNavigableHref(link: NavigableLinkElement): string {
  if (!isSvgAnchor(link)) {
    return link.href;
  }

  const rawHref =
    link.href.baseVal ||
    link.getAttribute("href") ||
    link.getAttributeNS(XLINK_NAMESPACE, "href") ||
    "";
  if (!rawHref) {
    return "";
  }

  try {
    return new URL(rawHref, link.ownerDocument.baseURI).toString();
  } catch {
    return "";
  }
}

export function getNavigableTarget(link: NavigableLinkElement): string {
  return isSvgAnchor(link) ? link.target.baseVal : link.target;
}

export function isSvgAnchor(link: NavigableLinkElement): link is SVGAElement {
  return link.namespaceURI === SVG_NAMESPACE;
}
