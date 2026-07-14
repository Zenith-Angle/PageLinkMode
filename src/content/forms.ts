export function shouldSkipFormNavigationEvent(event: SubmitEvent): boolean {
  return event.isTrusted === false || event.defaultPrevented || !event.cancelable;
}

export function canSafelyTakeOverForm(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): boolean {
  const method = (form.method || "get").toLowerCase();
  if (method !== "get") {
    return false;
  }

  const baseTarget = form.ownerDocument
    ?.querySelector<HTMLBaseElement>("base[target]")
    ?.target ?? "";
  const effectiveTarget = (form.target || baseTarget).trim().toLowerCase();
  if (effectiveTarget !== "" && effectiveTarget !== "_self") {
    return false;
  }

  if (!submitter) {
    return true;
  }

  // 原型 submit() 不会携带 submitter 的 name/value，也不会应用 form* 覆写；这些情况保持原生。
  return !(
    submitter.hasAttribute("name") ||
    submitter.hasAttribute("formaction") ||
    submitter.hasAttribute("formmethod") ||
    submitter.hasAttribute("formtarget") ||
    submitter.hasAttribute("formenctype") ||
    submitter.hasAttribute("formnovalidate") ||
    submitter.getAttribute("type")?.toLowerCase() === "image"
  );
}

export function getEffectiveFormTarget(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): string {
  const baseTarget = form.ownerDocument
    ?.querySelector<HTMLBaseElement>("base[target]")
    ?.target ?? "";
  const effectiveTarget = submitter?.hasAttribute("formtarget")
    ? submitter.getAttribute("formtarget") ?? ""
    : form.hasAttribute("target")
      ? form.target
      : baseTarget;
  return (effectiveTarget || "_self").trim().toLowerCase();
}

export function getNativeFormDisposition(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): "same-tab" | "new-tab" | "preserve-native" {
  const target = getEffectiveFormTarget(form, submitter);
  if (target === "" || target === "_self") {
    return "same-tab";
  }
  if (target === "_blank") {
    return "new-tab";
  }
  return "preserve-native";
}

export function overrideFormTargetForNativeSubmission(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  disposition: "same-tab" | "new-tab",
): void {
  const targetValue = disposition === "same-tab" ? "_self" : "_blank";
  const targetOwner = submitter?.hasAttribute("formtarget") ? submitter : form;
  const attributeName = targetOwner === form ? "target" : "formtarget";
  const previousValue = targetOwner.getAttribute(attributeName);

  // 只临时改变浏览上下文，让浏览器继续负责校验、successful controls 和编码。
  targetOwner.setAttribute(attributeName, targetValue);
  window.setTimeout(() => {
    if (previousValue === null) {
      targetOwner.removeAttribute(attributeName);
      return;
    }
    targetOwner.setAttribute(attributeName, previousValue);
  }, 0);
}

export function submitFormInCurrentTab(form: HTMLFormElement): void {
  const previousTarget = form.target;
  form.target = "_self";
  HTMLFormElement.prototype.submit.call(form);
  form.target = previousTarget;
}

export function submitFormInNewTab(form: HTMLFormElement): void {
  const previousTarget = form.target;
  const targetName = `pagelinkmode_${Date.now()}`;
  window.open("about:blank", targetName, "noopener");
  form.target = targetName;
  HTMLFormElement.prototype.submit.call(form);
  form.target = previousTarget;
}
