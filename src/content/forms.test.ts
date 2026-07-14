import test from "node:test";
import assert from "node:assert/strict";

import {
  canSafelyTakeOverForm,
  getEffectiveFormTarget,
  getNativeFormDisposition,
  overrideFormTargetForNativeSubmission,
  shouldSkipFormNavigationEvent,
} from "./forms";
import { applyNavigationExecutionOutcome } from "../lib/navigation";

test("非可信、已取消和不可取消的 submit 事件始终保持原生", () => {
  assert.equal(shouldSkipFormNavigationEvent(createSubmitEvent({ isTrusted: false })), true);
  assert.equal(shouldSkipFormNavigationEvent(createSubmitEvent({ defaultPrevented: true })), true);
  assert.equal(shouldSkipFormNavigationEvent(createSubmitEvent({ cancelable: false })), true);
  assert.equal(shouldSkipFormNavigationEvent(createSubmitEvent()), false);
});

test("页面最终取消表单提交时不会虚报规则已应用", () => {
  const decision = {
    category: "form-search-get" as const,
    requestedDisposition: "new-tab" as const,
    nativeDisposition: "same-tab" as const,
    disposition: "new-tab" as const,
    applied: true,
    reason: "global-category:form-search-get",
    resolvedBy: "global-category" as const,
  };

  const actual = applyNavigationExecutionOutcome(decision, {
    applied: false,
    disposition: decision.nativeDisposition,
    bypassReason: "page-prevented",
  });

  assert.equal(actual.applied, false);
  assert.equal(actual.disposition, "same-tab");
  assert.equal(actual.bypassReason, "page-prevented");
});

test("只接管没有特殊 target 或 submitter 覆写语义的简单 GET 表单", () => {
  const getForm = { method: "GET", target: "" } as HTMLFormElement;
  const postForm = { method: "POST" } as HTMLFormElement;
  const namedTargetForm = { method: "GET", target: "preview" } as HTMLFormElement;
  const baseTargetForm = {
    method: "GET",
    target: "",
    ownerDocument: {
      querySelector: () => ({ target: "_blank" }),
    },
  } as unknown as HTMLFormElement;
  const plainSubmitter = createSubmitter({});
  const namedSubmitter = createSubmitter({ name: "search" });
  const overrideSubmitter = createSubmitter({ formaction: "/alternate" });

  assert.equal(canSafelyTakeOverForm(getForm, null), true);
  assert.equal(canSafelyTakeOverForm(getForm, plainSubmitter), true);
  assert.equal(canSafelyTakeOverForm(getForm, namedSubmitter), false);
  assert.equal(canSafelyTakeOverForm(getForm, overrideSubmitter), false);
  assert.equal(canSafelyTakeOverForm(postForm, null), false);
  assert.equal(canSafelyTakeOverForm(namedTargetForm, null), false);
  assert.equal(canSafelyTakeOverForm(baseTargetForm, null), false);
});

test("按 submitter、form、base 的优先级解析原生表单目标", () => {
  const cases: Array<{
    name: string;
    formTarget?: string;
    baseTarget?: string;
    submitterTarget?: string;
    expectedTarget: string;
    expectedDisposition: "same-tab" | "new-tab" | "preserve-native";
  }> = [
    {
      name: "form _self",
      formTarget: "_self",
      expectedTarget: "_self",
      expectedDisposition: "same-tab",
    },
    {
      name: "form _blank",
      formTarget: "_blank",
      expectedTarget: "_blank",
      expectedDisposition: "new-tab",
    },
    {
      name: "form 命名目标",
      formTarget: "preview",
      expectedTarget: "preview",
      expectedDisposition: "preserve-native",
    },
    {
      name: "base _self",
      baseTarget: "_self",
      expectedTarget: "_self",
      expectedDisposition: "same-tab",
    },
    {
      name: "base _blank",
      baseTarget: "_blank",
      expectedTarget: "_blank",
      expectedDisposition: "new-tab",
    },
    {
      name: "base 命名目标",
      baseTarget: "results",
      expectedTarget: "results",
      expectedDisposition: "preserve-native",
    },
    {
      name: "submitter _self 覆写 form",
      formTarget: "_blank",
      submitterTarget: "_self",
      expectedTarget: "_self",
      expectedDisposition: "same-tab",
    },
    {
      name: "submitter _blank 覆写 base",
      baseTarget: "results",
      submitterTarget: "_blank",
      expectedTarget: "_blank",
      expectedDisposition: "new-tab",
    },
    {
      name: "submitter 命名目标",
      formTarget: "_self",
      submitterTarget: "report-frame",
      expectedTarget: "report-frame",
      expectedDisposition: "preserve-native",
    },
    {
      name: "显式空 form target 覆写 base",
      formTarget: "",
      baseTarget: "results",
      expectedTarget: "_self",
      expectedDisposition: "same-tab",
    },
    {
      name: "显式空 submitter target 覆写 form",
      formTarget: "_blank",
      submitterTarget: "",
      expectedTarget: "_self",
      expectedDisposition: "same-tab",
    },
  ];

  for (const item of cases) {
    const form = createForm(item.formTarget, item.baseTarget);
    const submitter = item.submitterTarget !== undefined
      ? createSubmitter({ formtarget: item.submitterTarget })
      : null;

    assert.equal(
      getEffectiveFormTarget(form, submitter),
      item.expectedTarget,
      `${item.name} 应解析出正确 target`,
    );
    assert.equal(
      getNativeFormDisposition(form, submitter),
      item.expectedDisposition,
      `${item.name} 应保持原生浏览上下文语义`,
    );
  }
});

test("原生提交只临时覆写 form target，并在下一个任务恢复缺失状态", () => {
  const form = createForm();

  withControlledScheduler((runScheduledTasks) => {
    overrideFormTargetForNativeSubmission(form, null, "new-tab");

    assert.equal(form.getAttribute("target"), "_blank");
    assert.equal(runScheduledTasks.pendingCount(), 1);

    runScheduledTasks();
    assert.equal(form.getAttribute("target"), null);
  });
});

test("有 formtarget 的 submitter 只临时覆写自身，并恢复原命名目标", () => {
  const form = createForm("form-frame");
  const submitter = createSubmitter({ formtarget: "button-frame" });

  withControlledScheduler((runScheduledTasks) => {
    overrideFormTargetForNativeSubmission(form, submitter, "same-tab");

    assert.equal(form.getAttribute("target"), "form-frame");
    assert.equal(submitter.getAttribute("formtarget"), "_self");
    assert.equal(runScheduledTasks.pendingCount(), 1);

    runScheduledTasks();
    assert.equal(form.getAttribute("target"), "form-frame");
    assert.equal(submitter.getAttribute("formtarget"), "button-frame");
  });
});

function createSubmitEvent(overrides: Partial<SubmitEvent> = {}): SubmitEvent {
  return {
    isTrusted: true,
    defaultPrevented: false,
    cancelable: true,
    ...overrides,
  } as SubmitEvent;
}

function createSubmitter(attributes: Record<string, string>): HTMLElement {
  const currentAttributes = { ...attributes };
  return {
    hasAttribute(name: string) {
      return Object.hasOwn(currentAttributes, name);
    },
    getAttribute(name: string) {
      return currentAttributes[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      currentAttributes[name] = value;
    },
    removeAttribute(name: string) {
      delete currentAttributes[name];
    },
  } as HTMLElement;
}

function createForm(target?: string, baseTarget = ""): HTMLFormElement {
  const attributes: Record<string, string> = {};
  if (target !== undefined) {
    attributes.target = target;
  }

  return {
    method: "GET",
    target: target ?? "",
    ownerDocument: {
      querySelector() {
        return baseTarget ? { target: baseTarget } : null;
      },
    },
    hasAttribute(name: string) {
      return Object.hasOwn(attributes, name);
    },
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    removeAttribute(name: string) {
      delete attributes[name];
    },
  } as unknown as HTMLFormElement;
}

function withControlledScheduler(
  assertion: (
    runScheduledTasks: (() => void) & { pendingCount(): number },
  ) => void,
): void {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const scheduledTasks: Array<() => void> = [];
  const runScheduledTasks = Object.assign(
    () => {
      for (const task of scheduledTasks.splice(0)) {
        task();
      }
    },
    {
      pendingCount: () => scheduledTasks.length,
    },
  );

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback: () => void, delay: number) {
        assert.equal(delay, 0);
        scheduledTasks.push(callback);
        return scheduledTasks.length;
      },
    },
  });

  try {
    assertion(runScheduledTasks);
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}
