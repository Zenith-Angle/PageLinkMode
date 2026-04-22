import type { NavigationDebugRecord, NavigationDebugRecordInput } from "./types";
import { getHostname } from "./url";

const DEBUG_RECORDS_KEY = "debugRecords";
const DEBUG_RECORD_LIMIT = 50;

export async function appendDebugRecord(
  recordInput: NavigationDebugRecordInput,
): Promise<NavigationDebugRecord> {
  const nextRecord: NavigationDebugRecord = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    hostname: getHostname(recordInput.pageUrl),
    ...recordInput,
  };
  const records = await readDebugRecords();
  const nextRecords = [nextRecord, ...records].slice(0, DEBUG_RECORD_LIMIT);
  await chrome.storage.session.set({ [DEBUG_RECORDS_KEY]: nextRecords });
  return nextRecord;
}

export async function readDebugRecords(): Promise<NavigationDebugRecord[]> {
  const stored = await chrome.storage.session.get(DEBUG_RECORDS_KEY);
  return sanitizeDebugRecords(stored[DEBUG_RECORDS_KEY]);
}

export async function clearDebugRecords(): Promise<void> {
  await chrome.storage.session.set({ [DEBUG_RECORDS_KEY]: [] });
}

function sanitizeDebugRecords(value: unknown): NavigationDebugRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is NavigationDebugRecord => isDebugRecord(entry))
    .slice(0, DEBUG_RECORD_LIMIT);
}

function isDebugRecord(value: unknown): value is NavigationDebugRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.hostname === "string" &&
    typeof record.pageUrl === "string" &&
    typeof record.targetUrl === "string" &&
    typeof record.trigger === "string" &&
    typeof record.category === "string" &&
    typeof record.disposition === "string" &&
    typeof record.resolvedBy === "string" &&
    typeof record.reason === "string"
  );
}
