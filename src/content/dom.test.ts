import test from "node:test";
import assert from "node:assert/strict";
import type { NavigableLinkElement } from "../lib/types";

class MockElement {
  parentElement: MockElement | null = null;

  constructor(private readonly anchor: NavigableLinkElement | null = null) {}

  closest(selector: string): NavigableLinkElement | null {
    return selector.includes("a[href]") ? this.anchor : null;
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

const { getClosestAnchor } = await import("./dom");

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
