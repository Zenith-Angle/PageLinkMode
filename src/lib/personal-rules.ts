import { RE2JS } from "re2js";

import type {
  NavigationFacts,
  PersonalRule,
  PersonalRuleMatch,
  UrlMatcher,
} from "./types";
import { normalizePageUrl, parseUrl } from "./url";

const MAX_PATTERN_LENGTH = 512;
const MAX_MATCH_INPUT_LENGTH = 16_384;
const MAX_REGEX_CACHE_SIZE = 128;
const SAFE_SELECTOR = /^(?:[a-z][\w-]*)?(?:#[\w-]+)?(?:\.[\w-]+)*(?:\[[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\]\s]+))?\])*$/i;
const regexCache = new Map<string, RE2JS | null>();

/**
 * 校验用户可配置的 URL 匹配器，确保保存后的规则一定能被运行时解释。
 */
export function validateUrlMatcher(matcher: UrlMatcher, fieldName = "URL 匹配器"): void {
  const value = matcher.value.trim();
  if (!value) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  if (value.length > MAX_PATTERN_LENGTH) {
    throw new Error(`${fieldName} 不能超过 ${MAX_PATTERN_LENGTH} 个字符。`);
  }

  if (matcher.kind === "regex") {
    compileRe2OrThrow(value, fieldName);
  } else if (matcher.kind === "glob") {
    compileRe2OrThrow(globToRe2(value), fieldName);
  }
}

/**
 * 个性化规则只接受单个元素的简单 selector，不开放组合器、伪类或伪元素。
 */
export function validateRestrictedCssSelector(
  rawSelector: string,
  fieldName = "CSS selector",
): void {
  const selector = rawSelector.trim();
  if (!selector) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  if (selector.length > MAX_PATTERN_LENGTH) {
    throw new Error(`${fieldName} 不能超过 ${MAX_PATTERN_LENGTH} 个字符。`);
  }
  if (!SAFE_SELECTOR.test(selector)) {
    throw new Error(`${fieldName} 超出允许范围，只支持单个元素的标签、ID、class 和属性匹配。`);
  }
}

export function findMatchingPersonalRule(
  facts: NavigationFacts,
  rules: PersonalRule[],
  scopeType: PersonalRule["scope"]["type"],
): PersonalRule | undefined {
  return rules
    .filter((rule) => rule.enabled && rule.scope.type === scopeType && isRuleInScope(rule, facts))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .find((rule) => matchesPersonalRule(rule.match, facts));
}

export function matchesPersonalRule(match: PersonalRuleMatch, facts: NavigationFacts): boolean {
  if (match.sourceUrl && !matchesUrl(match.sourceUrl, facts.sourceUrl)) {
    return false;
  }
  if (match.targetUrl && !matchesUrl(match.targetUrl, facts.targetUrl)) {
    return false;
  }
  if (match.relations?.length && !match.relations.includes(facts.relation)) {
    return false;
  }
  if (match.triggers?.length && !match.triggers.includes(facts.trigger)) {
    return false;
  }
  if (match.semantics?.length && !match.semantics.some((semantic) => facts.semantics.includes(semantic))) {
    return false;
  }
  if (match.nativeTargets?.length && !match.nativeTargets.includes(facts.nativeTarget)) {
    return false;
  }
  if (match.frameContexts?.length && !match.frameContexts.includes(facts.frameContext)) {
    return false;
  }
  if (
    match.formMethods?.length &&
    !match.formMethods.some((method) => method.toUpperCase() === facts.formMethod?.toUpperCase())
  ) {
    return false;
  }

  return match.element ? matchesElement(match.element, facts) : true;
}

export function matchesUrl(matcher: UrlMatcher, input: string): boolean {
  const value = matcher.value.trim();
  if (!value || value.length > MAX_PATTERN_LENGTH || input.length > MAX_MATCH_INPUT_LENGTH) {
    return false;
  }

  switch (matcher.kind) {
    case "exact":
      return input === value;
    case "prefix":
      return input.startsWith(value);
    case "glob":
      return testRe2(globToRe2(value), input);
    case "regex":
      return testRe2(value, input);
  }
}

function isRuleInScope(rule: PersonalRule, facts: NavigationFacts): boolean {
  const source = parseUrl(facts.sourceUrl);
  if (source === null || source.hostname.toLowerCase() !== rule.scope.hostname.toLowerCase()) {
    return false;
  }

  return rule.scope.type === "site" || normalizePageUrl(facts.sourceUrl) === rule.scope.pageKey;
}

function matchesElement(element: NonNullable<PersonalRuleMatch["element"]>, facts: NavigationFacts): boolean {
  const tag = facts.elementTag?.toLowerCase();
  const attributes = normalizeAttributes(facts.elementAttributes);

  if (element.tag && element.tag.toLowerCase() !== tag) {
    return false;
  }
  if (
    element.attributes &&
    !Object.entries(element.attributes).every(
      ([name, value]) => attributes[name.toLowerCase()] === value,
    )
  ) {
    return false;
  }

  return element.selector ? matchesSafeSelector(element.selector, tag, attributes) : true;
}

function matchesSafeSelector(
  rawSelector: string,
  tag: string | undefined,
  attributes: Record<string, string>,
): boolean {
  const selector = rawSelector.trim();
  if (!selector || selector.length > MAX_PATTERN_LENGTH || !SAFE_SELECTOR.test(selector)) {
    return false;
  }

  const tagMatch = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tagMatch && tagMatch.toLowerCase() !== tag) {
    return false;
  }

  const idMatch = selector.match(/#([\w-]+)/)?.[1];
  if (idMatch && attributes.id !== idMatch) {
    return false;
  }

  const classes = new Set((attributes.class ?? "").split(/\s+/).filter(Boolean));
  for (const className of selector.matchAll(/\.([\w-]+)/g)) {
    if (!classes.has(className[1])) {
      return false;
    }
  }

  for (const attribute of selector.matchAll(/\[([\w:-]+)(?:=("[^"]*"|'[^']*'|[^\]\s]+))?\]/g)) {
    const name = attribute[1].toLowerCase();
    if (!(name in attributes)) {
      return false;
    }
    if (attribute[2] !== undefined && attributes[name] !== stripQuotes(attribute[2])) {
      return false;
    }
  }

  return true;
}

function normalizeAttributes(attributes?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function globToRe2(glob: string): string {
  let pattern = "^";
  for (const character of glob) {
    if (character === "*") {
      pattern += ".*";
    } else if (character === "?") {
      pattern += ".";
    } else {
      pattern += RE2JS.quote(character);
    }
  }
  return `${pattern}$`;
}

function testRe2(pattern: string, input: string): boolean {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) {
    return cached?.test(input) ?? false;
  }

  try {
    const compiled = RE2JS.compile(pattern);
    rememberRegex(pattern, compiled);
    return compiled.test(input);
  } catch {
    // 无效或 RE2 不支持的表达式必须失败关闭，不能退回原生 RegExp。
    rememberRegex(pattern, null);
    return false;
  }
}

function compileRe2OrThrow(pattern: string, fieldName: string): void {
  try {
    RE2JS.compile(pattern);
  } catch {
    throw new Error(`${fieldName} 不是有效的 RE2 表达式，或使用了 RE2 不支持的语法。`);
  }
}

function rememberRegex(pattern: string, compiled: RE2JS | null): void {
  if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
    const oldest = regexCache.keys().next().value as string | undefined;
    if (oldest !== undefined) regexCache.delete(oldest);
  }
  regexCache.set(pattern, compiled);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
