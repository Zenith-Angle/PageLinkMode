import test from "node:test";
import assert from "node:assert/strict";
import type { NavigableLinkElement } from "../lib/types";

class MockElement {
  parentElement: MockElement | null = null;

  constructor(
    private readonly anchor: NavigableLinkElement | null = null,
    private readonly topicRow: MockElement | null = null,
    private readonly topicAnchor: HTMLAnchorElement | null = null,
    private readonly control = false,
  ) {}

  closest(selector: string): any {
    if (this.control && selector.includes("[role='button']")) return this;
    if (selector.includes("a[href]")) return this.anchor;
    if (selector.includes("tr.topic-list-item")) return this.topicRow;
    return null;
  }

  querySelector<T>(): T | null {
    return this.topicAnchor as T | null;
  }
}

class MockNode {
  constructor(public readonly parentElement: MockElement | null) {}
}

class MockFormElement extends MockElement {}

Object.assign(globalThis, {
  Element: MockElement,
  Node: MockNode,
  HTMLFormElement: MockFormElement,
});

const { getClosestAnchor, getClosestDiscourseTopicAnchor } = await import("./dom");

test("图像映射的 area href 进入标准链接识别链路", () => {
  const area = {
    href: "https://example.com/map/region",
    localName: "area",
    namespaceURI: "http://www.w3.org/1999/xhtml",
  } as HTMLAreaElement;
  const areaTarget = new MockElement(area);

  assert.equal(
    getClosestAnchor(
      areaTarget as unknown as EventTarget,
      [areaTarget] as unknown as EventTarget[],
    ),
    area,
  );
});

test("优先从 composedPath 找到开放式 Shadow DOM 内的真实链接", () => {
  const anchor = {
    href: "https://example.com/post/1",
    localName: "a",
    namespaceURI: "http://www.w3.org/1999/xhtml",
  } as HTMLAnchorElement;
  const shadowChild = new MockElement(anchor);
  const shadowHost = new MockElement(null);

  assert.equal(
    getClosestAnchor(
      shadowHost as unknown as EventTarget,
      [shadowChild, shadowHost] as unknown as EventTarget[],
    ),
    anchor,
  );
});

test("SVG a 会进入标准链接识别链路，并由后续适配层解析动画属性", () => {
  const svgAnchor = {
    localName: "a",
    namespaceURI: "http://www.w3.org/2000/svg",
  } as unknown as HTMLAnchorElement;
  const svgTarget = new MockElement(svgAnchor);

  assert.equal(
    getClosestAnchor(
      svgTarget as unknown as EventTarget,
      [svgTarget] as unknown as EventTarget[],
    ),
    svgAnchor,
  );
});

test("composedPath 未暴露内部节点时保持找不到链接，不穿透 closed shadow", () => {
  const shadowHost = new MockElement(null);

  assert.equal(
    getClosestAnchor(
      shadowHost as unknown as EventTarget,
      [shadowHost] as unknown as EventTarget[],
    ),
    null,
  );
});

test("Discourse 话题行的空白区域复用标题链接作为导航目标", () => {
  const title = {
    href: "https://linux.do/t/topic/123/1",
    localName: "a",
    namespaceURI: "http://www.w3.org/1999/xhtml",
  } as HTMLAnchorElement;
  const row = new MockElement(null, null, title);
  const whitespace = new MockElement(null, row);

  assert.equal(
    getClosestDiscourseTopicAnchor(whitespace as unknown as EventTarget, [whitespace] as unknown as EventTarget[]),
    title,
  );
});

test("Discourse 话题行中的动作控件不回退到标题链接", () => {
  const title = {
    href: "https://linux.do/t/topic/123/1",
    localName: "a",
    namespaceURI: "http://www.w3.org/1999/xhtml",
  } as HTMLAnchorElement;
  const row = new MockElement(null, null, title);
  const action = new MockElement(null, row, null, true);

  assert.equal(
    getClosestDiscourseTopicAnchor(action as unknown as EventTarget, [action] as unknown as EventTarget[]),
    null,
  );
});
