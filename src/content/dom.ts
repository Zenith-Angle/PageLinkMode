import type { NavigableLinkElement } from "../lib/types";

export function getClosestAnchor(
  target: EventTarget | null,
  composedPath: EventTarget[] = [],
): NavigableLinkElement | null {
  // open Shadow DOM 会把外部 event.target 重定向到宿主元素；composedPath 才能找到真实锚点。
  for (const pathTarget of composedPath) {
    const anchor = findClosestAnchor(pathTarget);
    if (anchor) {
      return anchor;
    }
  }

  return findClosestAnchor(target);
}

/**
 * Discourse topic lists also navigate when the click lands on a non-link part
 * of a topic row. Reuse the row's title anchor as the canonical target while
 * leaving clicks on actual controls to the page.
 */
export function getClosestDiscourseTopicAnchor(
  target: EventTarget | null,
  composedPath: EventTarget[] = [],
): HTMLAnchorElement | null {
  const element = findClosestElement(composedPath) ?? (target ? findClosestElement([target]) : null);
  if (
    !element ||
    element.closest(
      "a[href], area[href], button, input, select, textarea, label, [role='button'], [data-action], [contenteditable='true']",
    ) !== null
  ) {
    return null;
  }

  const row = element.closest("tr.topic-list-item[data-topic-id]");
  return row?.querySelector<HTMLAnchorElement>("a.title.raw-topic-link[href], a[data-topic-id][href]") ?? null;
}

export function getSubmitForm(target: EventTarget | null): HTMLFormElement | null {
  if (target instanceof HTMLFormElement) {
    return target;
  }
  const element = toElement(target);
  return element?.closest("form") ?? null;
}

export function hasPointerModifier(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function isPageHandledNavigationEvent(event: Event): boolean {
  return event.defaultPrevented || !event.cancelable;
}

function toElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function findClosestAnchor(target: EventTarget | null): NavigableLinkElement | null {
  const element = toElement(target);
  const candidate = element?.closest("a[href], area[href], a[xlink\\:href]");
  if (
    candidate === null ||
    candidate === undefined ||
    (candidate.namespaceURI === "http://www.w3.org/1999/xhtml" &&
      candidate.localName !== "a" &&
      candidate.localName !== "area") ||
    (candidate.namespaceURI === "http://www.w3.org/2000/svg" && candidate.localName !== "a") ||
    (candidate.namespaceURI !== "http://www.w3.org/1999/xhtml" &&
      candidate.namespaceURI !== "http://www.w3.org/2000/svg")
  ) {
    return null;
  }

  return candidate as NavigableLinkElement;
}

function findClosestElement(targets: EventTarget[]): Element | null {
  for (const target of targets) {
    const element = toElement(target);
    if (element) return element;
  }
  return null;
}
