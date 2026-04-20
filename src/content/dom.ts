export function getClosestAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  const element = toElement(target);
  return element?.closest("a[href]") ?? null;
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
