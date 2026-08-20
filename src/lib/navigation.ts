import { getDomain } from "tldts";

import type {
  NavigationCapability,
  NavigationCategory,
  NavigationClassification,
  NavigationDecision,
  NavigationDecisionSource,
  NavigationDisposition,
  NavigationExecutionOutcome,
  NavigationFacts,
  NavigationFrameContext,
  NavigationRelation,
  NavigationResolutionContext,
  NavigationSemantic,
  NavigationUserIntent,
  NativeTargetKind,
  NavigableLinkElement,
  PersonalRule,
} from "./types";
import {
  isLikelyBreadcrumbTabNavigation,
  isLikelyForumFacetNavigation,
  isLikelyForumNavigation,
  isLikelyContentSequenceNavigation,
  isLikelyDocumentUrl,
  isLikelyImageViewerNavigation,
  isLikelyImageViewerUrl,
  isLikelyListDetailNavigation,
  isLikelyMediaUrl,
  isLikelyPaginationNavigation,
  isLikelyPrimaryNavigation,
  isLikelySearchFilterNavigation,
  isLikelySearchForm,
  isLikelySpaRoute,
  getFrontendActionControlSignal,
} from "./navigation-heuristics";
import { isHardNativeCategory } from "./navigation-categories";
import { findMatchingPersonalRule } from "./personal-rules";
import { getNavigableHref, getNavigableTarget } from "./navigable-link";
import { parseUrl } from "./url";

const AUTH_HOST_LABELS = new Set(["account", "accounts", "auth", "auth0", "idp", "login", "oauth", "signin", "sso"]);
const PAYMENT_HOST_LABELS = new Set(["alipay", "billing", "checkout", "pay", "payment", "payments", "paypal", "stripe", "wechatpay"]);
const AUTH_PATH_SEGMENTS = new Set([
  "2fa", "account", "accounts", "auth", "authorization", "authorize", "captcha", "callback", "idp", "login",
  "forgot-password", "logout", "mfa", "oauth", "oauth2", "oauth2callback", "oidc", "password", "recover", "register",
  "reset-password", "saml", "signin", "sign-in", "signin-oidc", "signup", "sign-up", "signout", "sign-out", "sso",
  "verify", "登录", "注册", "认证",
]);
const PAYMENT_PATH_SEGMENTS = new Set([
  "alipay", "billing", "checkout", "confirm-order", "order-confirmation", "pay", "payment", "payments", "paypal",
  "place-order", "purchase", "stripe", "wechatpay", "支付", "结算",
]);
const AUTH_QUERY_KEYS = new Set([
  "client_id", "code_challenge", "code_challenge_method", "grant_type", "id_token_hint", "oauth_token", "redirect_uri",
  "response_type", "samlrequest", "samlresponse",
]);
const PAYMENT_QUERY_KEYS = new Set(["payment_intent", "payment_method"]);
const CONTENT_PATH_PREFIXES = new Set(["article", "articles", "author", "authors", "blog", "docs", "documentation", "news", "post", "posts", "session", "sessions", "wiki"]);
const POPUP_FEATURE_NAMES = new Set([
  "height", "innerheight", "innerwidth", "left", "location", "menubar", "outerheight", "outerwidth", "resizable",
  "screenx", "screeny", "scrollbars", "status", "toolbar", "top", "width",
]);
const HARD_REL_TOKENS = new Set(["opener", "noopener", "noreferrer"]);
const ELEMENT_ATTRIBUTE_LIMIT = 64;

export interface NavigationFactOptions {
  sourceUrl?: string;
  frameContext?: NavigationFrameContext;
  userIntent?: NavigationUserIntent;
  documentBaseTarget?: string;
}

interface ResolvedAction {
  requestedDisposition: NavigationDisposition;
  resolvedBy: NavigationDecisionSource;
  winningRule?: PersonalRule;
  reason: string;
}

export function classifyAnchorNavigation(
  anchor: NavigableLinkElement,
  currentUrl: string,
  options: NavigationFactOptions = {},
): NavigationFacts {
  const sourceUrl = options.sourceUrl ?? currentUrl;
  const targetUrl = getNavigableHref(anchor);
  const baseTarget = options.documentBaseTarget ?? getDocumentBaseTarget(anchor.ownerDocument);
  const rawTarget = anchor.hasAttribute("target") ? getNavigableTarget(anchor) : baseTarget;
  const nativeTarget = classifyNativeTarget(rawTarget, "self");
  const semantics = classifyAnchorSemantics(anchor, sourceUrl, targetUrl);
  const evidence = semantics.map((semantic) => `semantic:${semantic}`);
  const frontendActionReason = getFrontendActionControlSignal(anchor, targetUrl);
  const attributes = collectElementAttributes(anchor);
  const userIntent = options.userIntent ?? "plain";
  const protocol = parseUrl(targetUrl)?.protocol ?? "";
  const relation = classifyNavigationRelation(sourceUrl, targetUrl);
  const frameContext = options.frameContext ?? inferFrameContext(anchor.ownerDocument);
  const capability = buildCapability({
    trigger: "anchor",
    protocol,
    relation,
    semantics,
    nativeTarget,
    userIntent,
    elementAttributes: attributes,
    frontendActionReason,
  });

  return {
    trigger: "anchor",
    sourceUrl,
    targetUrl,
    relation,
    protocol,
    semantics,
    nativeTarget,
    nativeDisposition: dispositionForTarget(nativeTarget),
    frameContext,
    userIntent,
    elementTag: getElementTag(anchor, "a"),
    elementAttributes: attributes,
    evidence: [
      ...evidence,
      ...(frontendActionReason ? [`frontend-action:${frontendActionReason}`] : []),
      `relation:${relation}`,
      ...capability.blockers.map((item) => `blocker:${item}`),
    ],
    capability,
  };
}

export function classifyFormNavigation(
  form: HTMLFormElement,
  submitter?: HTMLElement | null,
  currentUrl?: string,
  options: NavigationFactOptions = {},
): NavigationFacts {
  const sourceUrl = options.sourceUrl ?? currentUrl ?? getDocumentUrl(form.ownerDocument);
  const targetUrl = getEffectiveFormAction(form, submitter, sourceUrl);
  const method = getEffectiveFormMethod(form, submitter);
  const rawTarget = getEffectiveFormTarget(form, submitter);
  const nativeTarget = classifyNativeTarget(rawTarget, "self");
  const sensitiveSemantic = classifySensitiveUrl(targetUrl) ?? classifySensitiveElement(form);
  const semantics: NavigationSemantic[] = sensitiveSemantic
    ? [sensitiveSemantic]
    : method === "GET" && isLikelySearchForm(form)
      ? ["search-filter"]
      : ["unknown"];
  const attributes = collectElementAttributes(form);
  const protocol = parseUrl(targetUrl)?.protocol ?? "";
  const relation = classifyNavigationRelation(sourceUrl, targetUrl);
  const frameContext = options.frameContext ?? inferFrameContext(form.ownerDocument);
  const capability = buildCapability({
    trigger: "form",
    protocol,
    relation,
    semantics,
    nativeTarget,
    userIntent: options.userIntent ?? "plain",
    formMethod: method,
    elementAttributes: attributes,
  });

  return {
    trigger: "form",
    sourceUrl,
    targetUrl,
    relation,
    protocol,
    semantics,
    nativeTarget,
    nativeDisposition: dispositionForTarget(nativeTarget),
    frameContext,
    userIntent: options.userIntent ?? "plain",
    formMethod: method,
    elementTag: "form",
    elementAttributes: attributes,
    evidence: [
      `method:${method}`,
      `relation:${relation}`,
      ...semantics.map((semantic) => `semantic:${semantic}`),
      ...capability.blockers.map((item) => `blocker:${item}`),
    ],
    capability,
  };
}

export function classifyWindowOpen(
  url: URL,
  target: string | undefined,
  features: string | undefined,
  currentUrl?: string,
  options: NavigationFactOptions = {},
): NavigationFacts {
  const sourceUrl = options.sourceUrl ?? currentUrl ?? getRuntimePageUrl();
  const targetUrl = url.toString();
  const nativeTarget = classifyNativeTarget(target, "blank");
  const sensitiveSemantic = classifySensitiveUrl(targetUrl);
  const semantics: NavigationSemantic[] = isPopupLikeWindowOpen(features) || isSpecialNativeTarget(nativeTarget)
    ? ["popup"]
    : sensitiveSemantic
      ? [sensitiveSemantic]
      : isLikelyImageViewerUrl(targetUrl)
        ? ["image-gallery"]
        : isLikelyDocumentUrl(targetUrl)
          ? ["document"]
          : isLikelyMediaUrl(targetUrl)
            ? ["media"]
            : ["content"];
  const protocol = url.protocol;
  const relation = classifyNavigationRelation(sourceUrl, targetUrl);
  const userIntent = options.userIntent ?? "script-active";
  const capability = buildCapability({
    trigger: "window.open",
    protocol,
    relation,
    semantics,
    nativeTarget,
    userIntent,
  });

  return {
    trigger: "window.open",
    sourceUrl,
    targetUrl,
    relation,
    protocol,
    semantics,
    nativeTarget,
    nativeDisposition: dispositionForTarget(nativeTarget),
    frameContext: options.frameContext ?? inferRuntimeFrameContext(),
    userIntent,
    evidence: [
      `relation:${relation}`,
      `target:${nativeTarget}`,
      ...semantics.map((semantic) => `semantic:${semantic}`),
      ...capability.blockers.map((item) => `blocker:${item}`),
    ],
    capability,
  };
}

export function classifyNavigationFacts(facts: NavigationFacts): NavigationClassification {
  const category = categoryForFacts(facts);
  return {
    category,
    reason: `classified:${category}`,
    semantics: facts.semantics,
    evidence: facts.evidence,
  };
}

export function resolveNavigationDecision(
  facts: NavigationFacts,
  context: NavigationResolutionContext,
): NavigationDecision {
  const classification = classifyNavigationFacts(facts);
  const action = resolveRequestedAction(facts, classification.category, context);
  return finalizeDecision(classification, facts, action);
}

export function acceptReportedWindowOpenOutcome(
  expected: NavigationDecision,
  reported: NavigationDecision,
): NavigationDecision {
  if (!hasSameDecisionIdentity(expected, reported)) return expected;
  if (
    reported.applied === expected.applied &&
    reported.disposition === expected.disposition &&
    reported.bypassReason === expected.bypassReason
  ) {
    return reported;
  }
  if (
    expected.applied &&
    expected.disposition === "new-tab" &&
    !reported.applied &&
    reported.disposition === expected.nativeDisposition &&
    reported.bypassReason === "popup-blocked"
  ) {
    return reported;
  }
  return expected;
}

export function applyNavigationExecutionOutcome(
  decision: NavigationDecision,
  outcome: NavigationExecutionOutcome,
): NavigationDecision {
  return {
    ...decision,
    disposition: outcome.disposition,
    applied: outcome.applied,
    ...(outcome.bypassReason === undefined ? {} : { bypassReason: outcome.bypassReason }),
  };
}

function hasSameDecisionIdentity(left: NavigationDecision, right: NavigationDecision): boolean {
  return (
    left.category === right.category &&
    left.requestedDisposition === right.requestedDisposition &&
    left.nativeDisposition === right.nativeDisposition &&
    left.reason === right.reason &&
    left.resolvedBy === right.resolvedBy &&
    left.winningRuleId === right.winningRuleId
  );
}

function resolveRequestedAction(
  facts: NavigationFacts,
  category: NavigationCategory,
  context: NavigationResolutionContext,
): ResolvedAction {
  if (!facts.capability.canRewrite || facts.capability.risk === "hard-blocked" || isHardNativeCategory(category)) {
    return {
      requestedDisposition: "preserve-native",
      resolvedBy: "capability",
      reason: facts.capability.blockers[0] ?? "hard-native-category",
    };
  }

  if (!context.siteEnabled) {
    return { requestedDisposition: "preserve-native", resolvedBy: "disabled", reason: "site-disabled" };
  }

  const sensitive = facts.capability.risk === "sensitive";
  if (sensitive && !hasRiskGrantForSource(context, facts.sourceUrl)) {
    return { requestedDisposition: "preserve-native", resolvedBy: "risk", reason: "risk-grant-required" };
  }

  const candidateRules = sensitive
    ? context.personalRules.filter((rule) => rule.sensitiveEnabled)
    : context.personalRules;
  const pageRule = findMatchingPersonalRule(facts, candidateRules, "page");
  if (pageRule) {
    return personalRuleAction(pageRule, "personal-page");
  }

  if (sensitive) {
    const siteRule = findMatchingPersonalRule(facts, candidateRules, "site");
    return siteRule
      ? personalRuleAction(siteRule, "personal-site")
      : { requestedDisposition: "preserve-native", resolvedBy: "risk", reason: "sensitive-rule-required" };
  }

  if (context.pageMode !== "inherit") {
    return { requestedDisposition: context.pageMode, resolvedBy: "page", reason: "page-overall-rule" };
  }

  const siteRule = findMatchingPersonalRule(facts, candidateRules, "site");
  if (siteRule) {
    return personalRuleAction(siteRule, "personal-site");
  }

  if (context.siteMode !== "inherit") {
    return { requestedDisposition: context.siteMode, resolvedBy: "site", reason: "site-overall-rule" };
  }

  const parentCategory = parentCategoryForFacts(facts, category);
  const siteRuleAction = getCategoryAction(context.siteCategoryRules, category, parentCategory);
  if (siteRuleAction) {
    return { requestedDisposition: siteRuleAction, resolvedBy: "site-category", reason: `site-category:${category}` };
  }

  const globalRuleAction = getCategoryAction(context.globalCategoryRules, category, parentCategory);
  if (globalRuleAction) {
    return { requestedDisposition: globalRuleAction, resolvedBy: "global-category", reason: `global-category:${category}` };
  }

  return { requestedDisposition: "preserve-native", resolvedBy: "native-fallback", reason: "no-rule-matched" };
}

function finalizeDecision(
  classification: NavigationClassification,
  facts: NavigationFacts,
  action: ResolvedAction,
): NavigationDecision {
  const requested = action.requestedDisposition;
  const nativeDisposition = facts.nativeDisposition;
  let disposition = requested;
  let applied = false;
  let bypassReason: string | undefined;

  if (requested === "preserve-native") {
    disposition = nativeDisposition;
    bypassReason = action.reason;
  } else if (!facts.capability.canRewrite) {
    disposition = nativeDisposition;
    bypassReason = facts.capability.blockers[0] ?? "capability-blocked";
  } else if (requested === nativeDisposition) {
    disposition = nativeDisposition;
    bypassReason = "already-native";
  } else {
    applied = true;
  }

  return {
    category: classification.category,
    requestedDisposition: requested,
    nativeDisposition,
    disposition,
    applied,
    bypassReason,
    reason: action.reason,
    resolvedBy: action.resolvedBy,
    winningRuleId: action.winningRule?.id,
  };
}

function personalRuleAction(rule: PersonalRule, resolvedBy: "personal-page" | "personal-site"): ResolvedAction {
  return {
    requestedDisposition: rule.action,
    resolvedBy,
    winningRule: rule,
    reason: `personal-rule:${rule.name || rule.id}`,
  };
}

function categoryForFacts(facts: NavigationFacts): NavigationCategory {
  if (facts.trigger === "form") {
    if (hasAnySemantic(facts, "auth-account", "payment-checkout")) return "form-auth-payment";
    if (facts.formMethod !== "GET") return "form-non-get";
    return facts.semantics.includes("search-filter") ? "form-search-get" : "form-general-get";
  }

  if (facts.trigger === "window.open") {
    if (facts.semantics.includes("popup")) return "open-popup-named";
    if (hasAnySemantic(facts, "auth-account", "payment-checkout")) return "open-auth-payment";
    if (facts.semantics.includes("image-gallery")) return "open-image-gallery";
    if (hasAnySemantic(facts, "document", "media")) return "open-document-media";
    return relationCategory(facts.relation, "open");
  }

  if (facts.semantics.includes("payment-checkout")) return "link-payment-checkout";
  if (facts.semantics.includes("auth-account")) return "link-auth-account";
  if (facts.semantics.includes("site-root")) return "link-site-root";
  if (facts.semantics.includes("forum-facet")) return "link-forum-facet";
  if (facts.semantics.includes("forum-navigation")) return "link-forum-navigation";
  if (facts.semantics.includes("pagination")) return "link-pagination";
  if (facts.semantics.includes("content-sequence")) return "link-content-sequence";
  if (facts.semantics.includes("search-filter")) return "link-search-filter";
  if (facts.semantics.includes("image-gallery")) return "link-image-gallery";
  if (facts.semantics.includes("document")) return "link-document";
  if (facts.semantics.includes("media")) return "link-media";
  if (facts.semantics.includes("breadcrumb-tab")) return "link-breadcrumb-tab";
  if (facts.semantics.includes("primary-navigation")) return "link-primary-navigation";
  if (facts.semantics.includes("list-detail")) return "link-list-detail";
  if (facts.semantics.includes("spa-route")) return "link-spa-route";
  return relationCategory(facts.relation, "link");
}

function parentCategoryForFacts(
  facts: NavigationFacts,
  category: NavigationCategory,
): NavigationCategory | undefined {
  if (facts.trigger === "anchor" && !category.startsWith("link-same-" ) && category !== "link-cross-site") {
    return relationCategory(facts.relation, "link");
  }
  if (facts.trigger === "window.open" && !category.startsWith("open-same-") && category !== "open-cross-site") {
    return relationCategory(facts.relation, "open");
  }
  return undefined;
}

function relationCategory(relation: NavigationRelation, prefix: "link" | "open"): NavigationCategory {
  if (relation === "same-origin" || relation === "same-document") return `${prefix}-same-origin`;
  if (relation === "same-site") return `${prefix}-same-site`;
  return `${prefix}-cross-site`;
}

function getCategoryAction(
  rules: Partial<Record<NavigationCategory, NavigationDisposition | "inherit">>,
  category: NavigationCategory,
  parentCategory?: NavigationCategory,
): NavigationDisposition | undefined {
  const direct = rules[category];
  if (direct && direct !== "inherit") return direct;
  const parent = parentCategory ? rules[parentCategory] : undefined;
  return parent && parent !== "inherit" ? parent : undefined;
}

function classifyAnchorSemantics(
  anchor: NavigableLinkElement,
  currentUrl: string,
  targetUrl: string,
): NavigationSemantic[] {
  const sensitive = classifySensitiveUrl(targetUrl);
  if (sensitive) return [sensitive];
  const semantics: NavigationSemantic[] = [];
  const add = (semantic: NavigationSemantic, matched: boolean) => {
    if (matched) semantics.push(semantic);
  };
  add("site-root", isSiteRootNavigation(targetUrl));
  add("forum-facet", isLikelyForumFacetNavigation(anchor));
  add("forum-navigation", isLikelyForumNavigation(anchor));
  add("content-sequence", isLikelyContentSequenceNavigation(anchor));
  add("pagination", isLikelyPaginationNavigation(anchor, targetUrl));
  add("search-filter", isLikelySearchFilterNavigation(anchor, targetUrl));
  add("image-gallery", isLikelyImageViewerNavigation(anchor, targetUrl));
  add("document", isLikelyDocumentUrl(targetUrl));
  add("media", isLikelyMediaUrl(targetUrl));
  add("breadcrumb-tab", isLikelyBreadcrumbTabNavigation(anchor));
  add("primary-navigation", isLikelyPrimaryNavigation(anchor));
  add("list-detail", isLikelyListDetailNavigation(anchor));
  add("spa-route", isLikelySpaRoute(anchor, currentUrl, targetUrl));
  return semantics.length > 0 ? semantics : ["content"];
}

function buildCapability(input: {
  trigger: NavigationFacts["trigger"];
  protocol: string;
  relation: NavigationRelation;
  semantics: NavigationSemantic[];
  nativeTarget: NativeTargetKind;
  userIntent: NavigationUserIntent;
  formMethod?: string;
  elementAttributes?: Record<string, string>;
  frontendActionReason?: string | null;
}): NavigationCapability {
  const blockers: string[] = [];
  const hardBlock = (reason: string) => {
    if (!blockers.includes(reason)) blockers.push(reason);
  };

  if (input.protocol !== "http:" && input.protocol !== "https:") hardBlock("unsupported-protocol");
  if (
    input.trigger === "anchor" &&
    input.relation === "same-document" &&
    !input.semantics.includes("spa-route")
  ) {
    hardBlock("same-document-navigation");
  }
  // 明确的网页动作控件必须交给页面自己的 handler，避免捕获阶段先于收藏/点赞等状态更新而接管链接。
  if (input.trigger === "anchor" && input.frontendActionReason) {
    hardBlock("frontend-action-control");
  }
  if (input.userIntent === "modified" || input.userIntent === "middle") hardBlock("explicit-user-intent");
  if (input.userIntent === "script-passive") hardBlock("script-without-user-activation");
  if (isSpecialNativeTarget(input.nativeTarget)) hardBlock("special-or-named-target");
  if (input.semantics.includes("popup")) hardBlock("popup-window-semantics");
  if (input.formMethod === "DIALOG") hardBlock("dialog-form-method");

  const attributes = input.elementAttributes ?? {};
  if ("download" in attributes) hardBlock("download-attribute");
  if (attributes.ping) hardBlock("ping-attribution");
  if ("attributionsrc" in attributes) hardBlock("attribution-source");
  if (attributes.referrerpolicy?.trim()) hardBlock("referrer-policy");
  if ((attributes.rel ?? "").split(/\s+/).some((token) => HARD_REL_TOKENS.has(token.toLowerCase()))) {
    hardBlock("special-rel-semantics");
  }

  const sensitive =
    hasAnySemanticValue(input.semantics, "auth-account", "payment-checkout") ||
    (input.trigger === "form" && input.formMethod !== undefined && input.formMethod !== "GET");
  return {
    canRewrite: blockers.length === 0,
    risk: blockers.length > 0 ? "hard-blocked" : sensitive ? "sensitive" : "normal",
    blockers,
  };
}

export function classifyNavigationRelation(sourceUrl: string, targetUrl: string): NavigationRelation {
  const source = parseUrl(sourceUrl);
  const target = parseUrl(targetUrl);
  if (source === null || target === null) return "cross-site";
  if (
    source.origin === target.origin &&
    source.pathname === target.pathname &&
    source.search === target.search
  ) {
    return "same-document";
  }
  if (source.origin === target.origin) return "same-origin";
  return isSameSiteNavigation(source.toString(), target.toString()) ? "same-site" : "cross-site";
}

export function isSameOriginNavigation(currentUrl: string, nextUrl: string): boolean {
  const current = parseUrl(currentUrl);
  const next = parseUrl(nextUrl);
  return current !== null && next !== null && current.origin === next.origin;
}

export function isSameSiteNavigation(currentUrl: string, nextUrl: string): boolean {
  const current = parseUrl(currentUrl);
  const next = parseUrl(nextUrl);
  if (current === null || next === null) return false;
  const currentDomain = getDomain(current.hostname, { allowPrivateDomains: true });
  const nextDomain = getDomain(next.hostname, { allowPrivateDomains: true });
  return currentDomain !== null && nextDomain !== null
    ? currentDomain === nextDomain
    : current.hostname === next.hostname;
}

export function isSiteRootNavigation(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed !== null && (parsed.pathname === "/" || parsed.pathname === "") && parsed.search === "";
}

export function isLikelyAuthUrl(rawUrl: string): boolean {
  return classifySensitiveUrl(rawUrl) !== undefined;
}

export function isLikelyPaymentUrl(rawUrl: string): boolean {
  return classifySensitiveUrl(rawUrl) === "payment-checkout";
}

function classifySensitiveUrl(rawUrl: string): "auth-account" | "payment-checkout" | undefined {
  const parsed = parseUrl(rawUrl);
  if (parsed === null) return undefined;
  const hostLabels = parsed.hostname.toLowerCase().split(".");
  if (hostLabels.some((label) => PAYMENT_HOST_LABELS.has(label))) return "payment-checkout";
  if ([...parsed.searchParams.keys()].some((key) => PAYMENT_QUERY_KEYS.has(key.toLowerCase()))) return "payment-checkout";
  if (hostLabels.some((label) => AUTH_HOST_LABELS.has(label))) return "auth-account";
  if ([...parsed.searchParams.keys()].some((key) => AUTH_QUERY_KEYS.has(key.toLowerCase()))) return "auth-account";
  const segments = getDecodedPathSegments(parsed.pathname);
  // 内容路径只用于消除普通站点的误报，不能覆盖明确的认证/支付主机和协议参数。
  if (segments.length > 0 && CONTENT_PATH_PREFIXES.has(segments[0])) return undefined;
  if (segments.some((segment) => PAYMENT_PATH_SEGMENTS.has(segment))) return "payment-checkout";
  return segments.some((segment) => AUTH_PATH_SEGMENTS.has(segment)) ? "auth-account" : undefined;
}

function classifySensitiveElement(element: Element): "auth-account" | "payment-checkout" | undefined {
  const hints = [
    element.id,
    element.className,
    element.getAttribute?.("name") ?? "",
    element.getAttribute?.("aria-label") ?? "",
    element.textContent ?? "",
  ].join(" ");
  if (/(?:checkout|billing|payment|purchase|支付|付款|结算|购买)/i.test(hints)) return "payment-checkout";
  if (/(?:login|signin|sign-in|signup|sign-up|register|oauth|auth|登录|注册|认证)/i.test(hints)) return "auth-account";
  return undefined;
}

export function isPopupLikeWindowOpen(features: string | undefined): boolean {
  if (!features) return false;
  const parsed = parseWindowFeatures(features);
  const popupValue = parsed.get("popup");
  if (popupValue !== undefined && isEnabledWindowFeature(popupValue)) return true;
  return [...parsed.keys()].some((name) => POPUP_FEATURE_NAMES.has(name));
}

export function getEffectiveFormMethod(form: HTMLFormElement, submitter?: HTMLElement | null): string {
  if (submitter?.hasAttribute("formmethod")) {
    const override = submitter.getAttribute("formmethod")?.trim().toLowerCase() ?? "";
    return override === "post" || override === "dialog" ? override.toUpperCase() : "GET";
  }
  const method = (form.method || "get").trim().toLowerCase();
  return method === "post" || method === "dialog" ? method.toUpperCase() : "GET";
}

export function getNativeAnchorDisposition(
  anchor: NavigableLinkElement,
  documentBaseTarget = "",
): NavigationDisposition {
  const target = anchor.hasAttribute("target") ? getNavigableTarget(anchor) : documentBaseTarget;
  return dispositionForTarget(classifyNativeTarget(target, "self"));
}

export function getNativeWindowOpenDisposition(target: string | undefined): NavigationDisposition {
  return dispositionForTarget(classifyNativeTarget(target, "blank"));
}

export function shouldInterceptNavigation(
  desired: NavigationDisposition,
  native: NavigationDisposition,
): boolean {
  return desired !== "preserve-native" && native !== "preserve-native" && desired !== native;
}

function getEffectiveFormAction(form: HTMLFormElement, submitter: HTMLElement | null | undefined, sourceUrl: string): string {
  const override = submitter?.getAttribute?.("formaction")?.trim();
  const rawAction = override || form.action || form.getAttribute?.("action") || sourceUrl;
  try {
    return new URL(rawAction, sourceUrl).toString();
  } catch {
    return rawAction;
  }
}

function getEffectiveFormTarget(form: HTMLFormElement, submitter?: HTMLElement | null): string {
  if (submitter?.hasAttribute("formtarget")) return submitter.getAttribute("formtarget") ?? "";
  if (form.hasAttribute?.("target")) return form.target;
  return form.ownerDocument?.querySelector<HTMLBaseElement>("base[target]")?.target ?? "";
}

function classifyNativeTarget(rawTarget: string | undefined, empty: "self" | "blank"): NativeTargetKind {
  const target = rawTarget?.trim().toLowerCase() ?? "";
  if (!target) return empty;
  if (target === "_self") return "self";
  if (target === "_blank") return "blank";
  if (target === "_parent") return "parent";
  if (target === "_top") return "top";
  if (target === "_unfencedtop") return "unfenced-top";
  return "named";
}

function dispositionForTarget(target: NativeTargetKind): NavigationDisposition {
  if (target === "self") return "same-tab";
  if (target === "blank") return "new-tab";
  return "preserve-native";
}

function isSpecialNativeTarget(target: NativeTargetKind): boolean {
  return target === "named" || target === "parent" || target === "top" || target === "unfenced-top";
}

function collectElementAttributes(element: Element): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const attributes = element.attributes;
  if (attributes && Symbol.iterator in Object(attributes)) {
    for (const attribute of Array.from(attributes).slice(0, ELEMENT_ATTRIBUTE_LIMIT)) {
      entries.push([attribute.name.toLowerCase(), attribute.value.slice(0, 512)]);
    }
  } else {
    for (const name of ["id", "class", "rel", "title", "aria-label", "role", "target", "download", "ping", "attributionsrc", "referrerpolicy"]) {
      const value = element.getAttribute?.(name);
      if (value !== null && value !== undefined) entries.push([name, value.slice(0, 512)]);
    }
  }
  return Object.fromEntries(entries);
}

function getElementTag(element: Element, fallback: string): string {
  return element.tagName?.toLowerCase() || fallback;
}

function inferFrameContext(document: Document | null | undefined): NavigationFrameContext {
  const view = document?.defaultView;
  if (!view) return "top";
  try {
    if (view === view.top) return "top";
    return view.top?.location.origin === view.location.origin ? "same-origin-frame" : "cross-origin-frame";
  } catch {
    return "cross-origin-frame";
  }
}

function inferRuntimeFrameContext(): NavigationFrameContext {
  return typeof document === "undefined" ? "top" : inferFrameContext(document);
}

function getDocumentBaseTarget(document: Document | null | undefined): string {
  return document?.querySelector<HTMLBaseElement>("base[target]")?.target ?? "";
}

function getDocumentUrl(document: Document | null | undefined): string {
  return document?.location?.href ?? getRuntimePageUrl();
}

function getRuntimePageUrl(): string {
  return typeof location === "undefined" ? "about:blank" : location.href;
}

function hasRiskGrantForSource(context: NavigationResolutionContext, sourceUrl: string): boolean {
  const source = parseUrl(sourceUrl);
  return source !== null && context.riskGrant?.hostname.toLowerCase() === source.hostname.toLowerCase();
}

function hasAnySemantic(facts: NavigationFacts, ...semantics: NavigationSemantic[]): boolean {
  return hasAnySemanticValue(facts.semantics, ...semantics);
}

function hasAnySemanticValue(values: NavigationSemantic[], ...semantics: NavigationSemantic[]): boolean {
  return semantics.some((semantic) => values.includes(semantic));
}

function parseWindowFeatures(features: string): Map<string, string | null> {
  const parsed = new Map<string, string | null>();
  for (const token of features.split(/[,\s]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    const name = (separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex)).trim().toLowerCase();
    const value = separatorIndex === -1 ? null : trimmed.slice(separatorIndex + 1).trim().toLowerCase();
    if (name) parsed.set(name, value);
  }
  return parsed;
}

function isEnabledWindowFeature(value: string | null): boolean {
  return value === null || !/^(?:0|false|no)$/i.test(value);
}

function getDecodedPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      return segment.toLowerCase();
    }
  });
}
