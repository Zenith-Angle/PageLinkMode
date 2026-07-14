import test from "node:test";
import assert from "node:assert/strict";

import { getNavigableHref, getNavigableTarget } from "./navigable-link";
import { getNativeAnchorDisposition } from "./navigation";

test("HTML 链接直接使用浏览器已经解析的绝对 href 和字符串 target", () => {
  const anchor = {
    namespaceURI: "http://www.w3.org/1999/xhtml",
    href: "https://example.com/docs/page.html",
    target: "_blank",
  } as unknown as HTMLAnchorElement;

  assert.equal(getNavigableHref(anchor), "https://example.com/docs/page.html");
  assert.equal(getNavigableTarget(anchor), "_blank");
});

test("SVG 链接按文档 baseURI 解析 href，并读取动画 target 的 baseVal", () => {
  const anchor = {
    namespaceURI: "http://www.w3.org/2000/svg",
    href: { baseVal: "../legacy/page.html" },
    target: { baseVal: "_self" },
    ownerDocument: { baseURI: "https://example.com/assets/diagram.svg" },
    getAttribute: () => null,
    getAttributeNS: () => null,
  } as unknown as SVGAElement;

  assert.equal(getNavigableHref(anchor), "https://example.com/legacy/page.html");
  assert.equal(getNavigableTarget(anchor), "_self");
});

test("旧 SVG xlink:href 在 href.baseVal 为空时仍能解析", () => {
  const anchor = {
    namespaceURI: "http://www.w3.org/2000/svg",
    href: { baseVal: "" },
    target: { baseVal: "" },
    ownerDocument: { baseURI: "https://example.com/legacy/index.html" },
    getAttribute: () => null,
    getAttributeNS: (_namespace: string, name: string) =>
      name === "href" ? "page-2.html" : null,
  } as unknown as SVGAElement;

  assert.equal(getNavigableHref(anchor), "https://example.com/legacy/page-2.html");
});

test("显式空 target 覆写 base target，并保持当前上下文", () => {
  const anchor = {
    namespaceURI: "http://www.w3.org/1999/xhtml",
    href: "https://example.com/page",
    target: "",
    hasAttribute: (name: string) => name === "target",
  } as unknown as HTMLAnchorElement;

  assert.equal(getNativeAnchorDisposition(anchor, "_blank"), "same-tab");
});
