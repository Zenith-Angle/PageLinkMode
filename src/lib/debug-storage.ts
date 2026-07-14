import type { NavigationDebugRecord, NavigationDebugRecordInput } from "./types";
import { getHostname } from "./url";

const DEBUG_RECORDS_KEY = "debugRecords";
const DEBUG_RECORD_LIMIT = 50;

export async function appendDebugRecord(recordInput: NavigationDebugRecordInput): Promise<NavigationDebugRecord> {
  const nextRecord: NavigationDebugRecord = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    hostname: getHostname(recordInput.pageUrl),
    ...recordInput,
  };
  const records = await readDebugRecords();
  await chrome.storage.session.set({ [DEBUG_RECORDS_KEY]: [nextRecord, ...records].slice(0, DEBUG_RECORD_LIMIT) });
  return nextRecord;
}

export async function readDebugRecords(): Promise<NavigationDebugRecord[]> {
  const stored = await chrome.storage.session.get(DEBUG_RECORDS_KEY);
  return sanitizeDebugRecords(stored[DEBUG_RECORDS_KEY]);
}

export async function clearDebugRecords(): Promise<void> {
  await chrome.storage.session.set({ [DEBUG_RECORDS_KEY]: [] });
}

export function sanitizeDebugRecords(value: unknown): NavigationDebugRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDebugRecord).slice(0, DEBUG_RECORD_LIMIT);
}

function isDebugRecord(value: unknown): value is NavigationDebugRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.hostname === "string" &&
    typeof record.pageUrl === "string" &&
    typeof record.targetUrl === "string" &&
    (record.trigger === "anchor" || record.trigger === "form" || record.trigger === "window.open") &&
    typeof record.category === "string" &&
    isDisposition(record.requestedDisposition) &&
    isDisposition(record.nativeDisposition) &&
    isDisposition(record.disposition) &&
    typeof record.applied === "boolean" &&
    (record.bypassReason === undefined || typeof record.bypassReason === "string") &&
    typeof record.resolvedBy === "string" &&
    (record.winningRuleId === undefined || typeof record.winningRuleId === "string") &&
    Array.isArray(record.evidence) && record.evidence.every((entry) => typeof entry === "string") &&
    typeof record.reason === "string"
  );
}

function isDisposition(value: unknown): boolean {
  return value === "same-tab" || value === "new-tab" || value === "preserve-native";
}
