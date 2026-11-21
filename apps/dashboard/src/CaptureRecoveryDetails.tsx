import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface RecoveryPolicy { enabled: boolean; unhealthyChecks: number; minimumCaptureAgeSeconds: number; protectedStreams: true; }

export interface RecoveryCameraStatus {
  cameraId: string; allowed: boolean; reason?: string;
  attemptsInLastHour: number; cooldownRemainingMs: number;
  streaming: boolean; restarting: boolean; recordingEnabled: boolean; lastResult: string | null;
}

export interface RecoveryStatus {
  automaticEnabled: boolean; cooldownMinutes: number; maxAttemptsPerHour: number;
  cameras: RecoveryCameraStatus[];
}

export interface RecoveryEscalation { cameraId: string; severity: "critical"; failuresInWindow: number; firstFailureAt: string; lastFailureAt: string; unacknowledgedFailures: number; latestDetail: string; incidentStatus: "open" | "resolved"; resolvedAt: string | null; resolutionNote: string | null }

export interface RecoveryEscalationResponse { windowMinutes: number; threshold: number; escalations: RecoveryEscalation[] }

export interface RecoveryAuditEntry { type: "failure" | "success" | "acknowledged" | "resolved" | "reopened"; cameraId: string; at: string; detail: string }

export interface RecoveryEvent { cameraId: string; at: string; outcome: "success" | "failure"; detail: string; acknowledgedAt?: string | null }

export const recoveryEventKey = (event: RecoveryEvent) => `${event.at}|${event.cameraId}|${event.outcome}`;

export function CaptureRecoveryPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [policy, setPolicy] = useState<RecoveryPolicy | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [events, setEvents] = useState<RecoveryEvent[]>([]);
  const [audit, setAudit] = useState<RecoveryAuditEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditType, setAuditType] = useState("all");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [statisticsWindow, setStatisticsWindow] = useState<"24h" | "7d" | "30d">("7d");
  // Shared backend rules. Keep edits as a draft until the operator explicitly saves.
  type ReliabilityRules = { minAttempts: number; warningSuccessRate: number; criticalSuccessRate: number; warningFailures: number; criticalFailures: number };
  const [reliabilityRules, setReliabilityRules] = useState<ReliabilityRules>({ minAttempts: 3, warningSuccessRate: 80, criticalSuccessRate: 50, warningFailures: 2, criticalFailures: 4 });
  const [ruleHistory, setRuleHistory] = useState<Array<{ id: string; at: string; before: ReliabilityRules; after: ReliabilityRules; note: string }>>([]);
  const [ruleNote, setRuleNote] = useState("");
  const [importedRules, setImportedRules] = useState<ReliabilityRules | null>(null);
  const [importIntegrityStatus, setImportIntegrityStatus] = useState<string | null>(null);
  // Steps 136-138: Import diagnostics are local operator data, never sent to the backend.
  type ImportDiagnostic = { at: string; fileName: string; bytes: number; outcome: "verified" | "legacy" | "rejected"; checks: string[]; error?: string };
  const [importDiagnostics, setImportDiagnostics] = useState<ImportDiagnostic[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem("tournament-threshold-import-diagnostics-v1") || "[]"); return Array.isArray(raw) ? raw.slice(0, 50) : []; }
    catch { return []; }
  });
  const [diagnosticFilter, setDiagnosticFilter] = useState("all");
  // Milestones 139-143: local-only diagnostic review and portable troubleshooting exports.
  const [diagnosticSearch, setDiagnosticSearch] = useState("");
  const [diagnosticFrom, setDiagnosticFrom] = useState("");
  const [diagnosticTo, setDiagnosticTo] = useState("");
  const [diagnosticSort, setDiagnosticSort] = useState<"newest" | "oldest">("newest");
  // Milestones 144-148: paginated diagnostic review and single-record exports.
  const [diagnosticPageSize, setDiagnosticPageSize] = useState(10);
  const [diagnosticPage, setDiagnosticPage] = useState(1);
  const [diagnosticCopyNotice, setDiagnosticCopyNotice] = useState("");
  // Milestones 149-153: quick navigation, size/error review, and summary exports.
  const [diagnosticMinBytes, setDiagnosticMinBytes] = useState("");
  const [diagnosticMaxBytes, setDiagnosticMaxBytes] = useState("");
  const [diagnosticErrorsOnly, setDiagnosticErrorsOnly] = useState(false);
  const [diagnosticJumpPage, setDiagnosticJumpPage] = useState("1");
  // Steps 154-163: expanded local-only diagnostic navigation, inspection and reports.
  const [diagnosticFileFilter, setDiagnosticFileFilter] = useState("");
  const [diagnosticCheckFilter, setDiagnosticCheckFilter] = useState("");
  const [diagnosticShowChecks, setDiagnosticShowChecks] = useState(true);
  const [diagnosticShowErrors, setDiagnosticShowErrors] = useState(true);
  // Steps 164-173: local review controls. Never send diagnostic history to a capture node.
  const [diagnosticSelected, setDiagnosticSelected] = useState<string[]>([]);
  const [diagnosticPinnedOnly, setDiagnosticPinnedOnly] = useState(false);
  const [diagnosticPinned, setDiagnosticPinned] = useState<string[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem("tournament-threshold-import-pins-v1") || "[]"); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 50) : []; }
    catch { return []; }
  });
  const [diagnosticGroupBy, setDiagnosticGroupBy] = useState<"none" | "outcome" | "filename">("none");
  // Steps 174-183: bulk triage and privacy-safe diagnostic export options.
  const [diagnosticRedactExports, setDiagnosticRedactExports] = useState(false);
  const [diagnosticBulkNotice, setDiagnosticBulkNotice] = useState("");
  // Steps 184-193: local operator annotations, triage and report summaries.
  const [diagnosticNotes, setDiagnosticNotes] = useState<Record<string, string>>(() => {
    try { const raw: unknown = JSON.parse(localStorage.getItem("tournament-threshold-import-notes-v1") || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.length < 1000 && typeof value === "string").map(([key, value]) => [key, String(value).slice(0, 500)]));
    } catch { return {}; }
  });
  // Steps 194-203: browser-local triage status and priority, separate from backend incidents.
  type DiagnosticTriage = { status: "new" | "investigating" | "resolved"; priority: "low" | "normal" | "high" };
  const [diagnosticTriage, setDiagnosticTriage] = useState<Record<string, DiagnosticTriage>>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("tournament-threshold-import-triage-v1") || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, value]) => {
        if (key.length > 1000 || !value || typeof value !== "object" || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return ["new", "investigating", "resolved"].includes(String(item.status)) && ["low", "normal", "high"].includes(String(item.priority));
      })) as Record<string, DiagnosticTriage>;
    } catch { return {}; }
  });
  const [diagnosticTriageStatusFilter, setDiagnosticTriageStatusFilter] = useState("all");
  const [diagnosticTriagePriorityFilter, setDiagnosticTriagePriorityFilter] = useState("all");
  const [diagnosticTriageBulkStatus, setDiagnosticTriageBulkStatus] = useState<DiagnosticTriage["status"]>("investigating");
  const [diagnosticTriageBulkPriority, setDiagnosticTriageBulkPriority] = useState<DiagnosticTriage["priority"]>("high");
  function triageFor(key: string): DiagnosticTriage { return diagnosticTriage[key] || { status: "new", priority: "normal" }; }
  function updateDiagnosticTriage(keys: string[], change: Partial<DiagnosticTriage>) {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    setDiagnosticTriage(previous => {
      const next = { ...previous };
      for (const key of keys) {
        if (!valid.has(key)) continue;
        const value = { ...(previous[key] || { status: "new", priority: "normal" }), ...change };
        if (value.status === "new" && value.priority === "normal") delete next[key]; else next[key] = value;
      }
      try { localStorage.setItem("tournament-threshold-import-triage-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice(`Updated triage for ${keys.filter(key => valid.has(key)).length} record(s).`);
  }
  function cleanOrphanedDiagnosticTriage() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = Object.fromEntries(Object.entries(diagnosticTriage).filter(([key]) => valid.has(key)));
    const removed = Object.keys(diagnosticTriage).length - Object.keys(next).length;
    setDiagnosticTriage(next);
    try { localStorage.setItem("tournament-threshold-import-triage-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Cleaned ${removed} orphaned triage entry/entries.`);
  }
  function exportDiagnosticTriageRecords() {
    const records = filteredImportDiagnostics.map(item => ({ at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName, outcome: item.outcome, ...triageFor(diagnosticKey(item)) }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-triage-records", schema: 1, exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports, records }, null, 2), "threshold-import-triage-records.json", "application/json;charset=utf-8");
  }
  // Steps 204-213: operator review shortcuts and portable, browser-local triage reporting.
  const [diagnosticTriageOnlyOpen, setDiagnosticTriageOnlyOpen] = useState(false);
  const [diagnosticTriageOnlyHigh, setDiagnosticTriageOnlyHigh] = useState(false);
  const [diagnosticTriageReportIncludeNotes, setDiagnosticTriageReportIncludeNotes] = useState(false);
  const [diagnosticTriageReportLimit, setDiagnosticTriageReportLimit] = useState(50);
  function selectDiagnosticTriageMatches(predicate: (triage: DiagnosticTriage) => boolean) {
    const keys = filteredImportDiagnostics.filter(item => predicate(triageFor(diagnosticKey(item)))).map(diagnosticKey);
    setDiagnosticSelected(previous => Array.from(new Set([...previous, ...keys])));
    setDiagnosticBulkNotice(`Selected ${keys.length} matching triage record(s).`);
  }
  function exportDiagnosticTriageCsv() {
    const rows = filteredImportDiagnostics.slice(0, diagnosticTriageReportLimit).map(item => {
      const t = triageFor(diagnosticKey(item));
      return [item.at, diagnosticRedactExports ? "[redacted]" : item.fileName, item.outcome, t.status, t.priority, diagnosticTriageReportIncludeNotes ? (diagnosticNotes[diagnosticKey(item)] || "") : ""];
    });
    const safe = (value: string) => { const escaped = /^[\s]*[=+@\-]/.test(value) ? "'" + value : value; return '"' + escaped.replace(/"/g, '""') + '"'; };
    downloadDiagnosticFile([["Timestamp", "Filename", "Outcome", "Review status", "Priority", "Operator note"], ...rows].map(row => row.map(safe).join(",")).join("\r\n"), "threshold-import-triage-review.csv", "text/csv;charset=utf-8");
  }
  function exportDiagnosticTriageReviewJson() {
    const records = filteredImportDiagnostics.slice(0, diagnosticTriageReportLimit).map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, ...triageFor(diagnosticKey(item)),
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-triage-review", schema: 1, exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports, totalMatching: filteredImportDiagnostics.length, exported: records.length, records }, null, 2), "threshold-import-triage-review.json", "application/json;charset=utf-8");
  }
  // Steps 214-223: triage age, review queues, and portable review snapshots.
  const [diagnosticReviewAgeDays, setDiagnosticReviewAgeDays] = useState(0);
  const [diagnosticReviewRejectedOnly, setDiagnosticReviewRejectedOnly] = useState(false);
  const [diagnosticReviewMissingNotes, setDiagnosticReviewMissingNotes] = useState(false);
  const [diagnosticReviewSort, setDiagnosticReviewSort] = useState<"chronological" | "priority">("chronological");
  const [diagnosticReviewShowSummary, setDiagnosticReviewShowSummary] = useState(true);
  const diagnosticReviewCutoff = Date.now() - diagnosticReviewAgeDays * 86400000;
  function resetDiagnosticReviewQueue() {
    setDiagnosticReviewAgeDays(0); setDiagnosticReviewRejectedOnly(false); setDiagnosticReviewMissingNotes(false);
    setDiagnosticReviewSort("chronological"); setDiagnosticPage(1);
  }
  function exportDiagnosticReviewSnapshot() {
    const records = filteredImportDiagnostics.slice(0, diagnosticTriageReportLimit).map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, ...triageFor(diagnosticKey(item)),
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-review-snapshot", schema: 1,
      exportedAt: new Date().toISOString(), filters: { minAgeDays: diagnosticReviewAgeDays,
      rejectedOnly: diagnosticReviewRejectedOnly, missingNotesOnly: diagnosticReviewMissingNotes,
      order: diagnosticReviewSort }, filenamesRedacted: diagnosticRedactExports,
      totalMatching: filteredImportDiagnostics.length, records }, null, 2),
      "threshold-import-review-snapshot.json", "application/json;charset=utf-8");
  }
  // Steps 224-233: local-only review ownership and overdue queue controls.
  const [diagnosticReviewSlaDays, setDiagnosticReviewSlaDays] = useState(7);
  const [diagnosticReviewOverdueOnly, setDiagnosticReviewOverdueOnly] = useState(false);
  const [diagnosticReviewUnassignedOnly, setDiagnosticReviewUnassignedOnly] = useState(false);
  const [diagnosticReviewOwnerFilter, setDiagnosticReviewOwnerFilter] = useState("");
  const [diagnosticReviewBulkOwner, setDiagnosticReviewBulkOwner] = useState("");
  const [diagnosticReviewOwners, setDiagnosticReviewOwners] = useState<Record<string, string>>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("tournament-threshold-import-owners-v1") || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.length < 1000 && typeof value === "string" && value.length <= 80)) as Record<string, string>;
    } catch { return {}; }
  });
  function updateDiagnosticOwners(keys: string[], owner: string) {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const cleaned = owner.trim().slice(0, 80);
    setDiagnosticReviewOwners(previous => {
      const next = { ...previous };
      for (const key of keys) {
        if (!valid.has(key)) continue;
        if (cleaned) next[key] = cleaned; else delete next[key];
      }
      try { localStorage.setItem("tournament-threshold-import-owners-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice(`Updated ownership on ${keys.filter(key => valid.has(key)).length} record(s).`);
  }
  function cleanupDiagnosticOwners() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = Object.fromEntries(Object.entries(diagnosticReviewOwners).filter(([key]) => valid.has(key)));
    setDiagnosticReviewOwners(next);
    try { localStorage.setItem("tournament-threshold-import-owners-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Cleaned ${Object.keys(diagnosticReviewOwners).length - Object.keys(next).length} orphaned owner entry/entries.`);
  }
  function resetDiagnosticOwnershipFilters() {
    setDiagnosticReviewOverdueOnly(false); setDiagnosticReviewUnassignedOnly(false);
    setDiagnosticReviewOwnerFilter(""); setDiagnosticPage(1);
  }
  function exportDiagnosticOverdueQueue() {
    const cutoff = Date.now() - diagnosticReviewSlaDays * 86400000;
    const records = filteredImportDiagnostics.filter(item => triageFor(diagnosticKey(item)).status !== "resolved" && Date.parse(item.at) <= cutoff).map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, ...triageFor(diagnosticKey(item)), owner: diagnosticReviewOwners[diagnosticKey(item)] || "",
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-overdue-reviews", schema: 1,
      exportedAt: new Date().toISOString(), slaDays: diagnosticReviewSlaDays,
      filenamesRedacted: diagnosticRedactExports, records }, null, 2),
      "threshold-import-overdue-reviews.json", "application/json;charset=utf-8");
  }
  const [diagnosticNotesOnly, setDiagnosticNotesOnly] = useState(false);
  const [diagnosticNoteSearch, setDiagnosticNoteSearch] = useState("");
  const [diagnosticIncludeNotesInExports, setDiagnosticIncludeNotesInExports] = useState(false);
  function saveDiagnosticNote(key: string, note: string) {
    setDiagnosticNotes(previous => {
      const next = { ...previous }; const trimmed = note.slice(0, 500);
      if (trimmed.trim()) next[key] = trimmed; else delete next[key];
      try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  function clearSelectedDiagnosticNotes() {
    const keys = diagnosticSelected.filter(key => diagnosticNotes[key]);
    if (!keys.length || !window.confirm(`Remove operator notes from ${keys.length} selected record(s)?`)) return;
    setDiagnosticNotes(previous => {
      const next = { ...previous }; for (const key of keys) delete next[key];
      try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice(`Cleared ${keys.length} operator note(s).`);
  }
  function pruneOrphanedDiagnosticNotes() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = Object.fromEntries(Object.entries(diagnosticNotes).filter(([key]) => valid.has(key)));
    const removed = Object.keys(diagnosticNotes).length - Object.keys(next).length;
    setDiagnosticNotes(next);
    try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Cleaned ${removed} orphaned operator note(s).`);
  }


  const diagnosticKey = (item: ImportDiagnostic) => JSON.stringify([item.at, item.fileName, item.bytes, item.outcome]);
  function toggleDiagnosticPin(key: string) {
    setDiagnosticPinned(previous => {
      const next = previous.includes(key) ? previous.filter(x => x !== key) : [...previous, key].slice(-50);
      try { localStorage.setItem("tournament-threshold-import-pins-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  // Steps 244-253: browser-local review queue quick actions and workload snapshots.
  const [reviewFocusOwner, setReviewFocusOwner] = useState("");
  const [reviewFocusPriority, setReviewFocusPriority] = useState<"all" | "high" | "normal" | "low">("all");
  const [reviewFocusStatus, setReviewFocusStatus] = useState<"all" | "new" | "investigating" | "resolved">("all");
  const [reviewFocusOnlyOverdue, setReviewFocusOnlyOverdue] = useState(false);
  const [reviewFocusOnlyUnassigned, setReviewFocusOnlyUnassigned] = useState(false);
  const [reviewFocusSort, setReviewFocusSort] = useState<"age" | "priority">("age");
  const [reviewFocusLimit, setReviewFocusLimit] = useState(25);
  const [reviewFocusIncludeNotes, setReviewFocusIncludeNotes] = useState(false);
  function resetReviewFocus() {
    setReviewFocusOwner(""); setReviewFocusPriority("all"); setReviewFocusStatus("all");
    setReviewFocusOnlyOverdue(false); setReviewFocusOnlyUnassigned(false);
    setReviewFocusSort("age"); setReviewFocusLimit(25);
  }
  function exportReviewFocusSnapshot() {
    const records = reviewFocusRows.slice(0, reviewFocusLimit).map(item => {
      const key = diagnosticKey(item);
      return { at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
        outcome: item.outcome, owner: diagnosticReviewOwners[key] || "", ...triageFor(key),
        ...(reviewFocusIncludeNotes ? { note: diagnosticNotes[key] || "" } : {}) };
    });
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-review-focus", schema: 1,
      exportedAt: new Date().toISOString(), totalMatching: reviewFocusRows.length,
      exportedCount: records.length, filenamesRedacted: diagnosticRedactExports,
      filters: { owner: reviewFocusOwner, priority: reviewFocusPriority, status: reviewFocusStatus,
        overdue: reviewFocusOnlyOverdue, unassigned: reviewFocusOnlyUnassigned,
        sort: reviewFocusSort }, records }, null, 2), "review-focus-snapshot.json", "application/json;charset=utf-8");
  }
  // Steps 254-263: validated, browser-local review filter presets.
  type ReviewPreset = { name: string; owner: string; priority: typeof reviewFocusPriority;
    status: typeof reviewFocusStatus; overdue: boolean; unassigned: boolean;
    sort: typeof reviewFocusSort; limit: number; includeNotes: boolean };
  function validateReviewPreset(input: unknown): ReviewPreset {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Preset must be an object");
    const v = input as Record<string, unknown>;
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 60) throw new Error("Preset name must be 1-60 characters");
    if (typeof v.owner !== "string" || v.owner.length > 80) throw new Error("Owner filter must be at most 80 characters");
    if (!["all", "high", "normal", "low"].includes(String(v.priority))) throw new Error("Invalid priority filter");
    if (!["all", "new", "investigating", "resolved"].includes(String(v.status))) throw new Error("Invalid status filter");
    if (typeof v.overdue !== "boolean" || typeof v.unassigned !== "boolean" || typeof v.includeNotes !== "boolean") throw new Error("Invalid boolean filter");
    if (!["age", "priority"].includes(String(v.sort))) throw new Error("Invalid sort option");
    if (![10, 25, 50].includes(Number(v.limit))) throw new Error("Invalid snapshot limit");
    return v as ReviewPreset;
  }
  const [reviewPresets, setReviewPresets] = useState<ReviewPreset[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem("tournament-review-focus-presets-v1") || "[]");
      return Array.isArray(value) ? value.slice(0, 20).flatMap(item => { try { return [validateReviewPreset(item)]; } catch { return []; } }) : [];
    } catch { return []; }
  });
  const [reviewPresetName, setReviewPresetName] = useState("");
  const [reviewPresetSelected, setReviewPresetSelected] = useState("");
  const [reviewPresetMessage, setReviewPresetMessage] = useState("");
  function persistReviewPresets(next: ReviewPreset[]) {
    setReviewPresets(next);
    try { localStorage.setItem("tournament-review-focus-presets-v1", JSON.stringify(next)); }
    catch { setReviewPresetMessage("Preset updated in memory, but browser storage is unavailable."); }
  }
  function currentReviewPreset(name: string): ReviewPreset {
    return { name, owner: reviewFocusOwner, priority: reviewFocusPriority, status: reviewFocusStatus,
      overdue: reviewFocusOnlyOverdue, unassigned: reviewFocusOnlyUnassigned,
      sort: reviewFocusSort, limit: reviewFocusLimit, includeNotes: reviewFocusIncludeNotes };
  }
  function saveReviewPreset() {
    const name = reviewPresetName.trim();
    try {
      const preset = validateReviewPreset(currentReviewPreset(name));
      const existing = reviewPresets.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (existing && !window.confirm(`Replace saved preset "${existing.name}"?`)) return;
      if (!existing && reviewPresets.length >= 20) throw new Error("Maximum 20 presets. Delete one first.");
      persistReviewPresets([...reviewPresets.filter(item => item.name.toLowerCase() !== name.toLowerCase()), preset]);
      setReviewPresetSelected(name); setReviewPresetMessage(`Saved preset: ${name}`);
    } catch (error) { setReviewPresetMessage(String(error)); }
  }
  function applyReviewPreset() {
    const preset = reviewPresets.find(item => item.name === reviewPresetSelected);
    if (!preset) { setReviewPresetMessage("Choose a saved preset."); return; }
    setReviewFocusOwner(preset.owner); setReviewFocusPriority(preset.priority); setReviewFocusStatus(preset.status);
    setReviewFocusOnlyOverdue(preset.overdue); setReviewFocusOnlyUnassigned(preset.unassigned);
    setReviewFocusSort(preset.sort); setReviewFocusLimit(preset.limit); setReviewFocusIncludeNotes(preset.includeNotes);
    setReviewPresetMessage(`Applied preset: ${preset.name}. No diagnostic records were changed.`);
  }
  function renameReviewPreset() {
    const name = reviewPresetName.trim();
    if (!reviewPresetSelected) return;
    try {
      const selected = reviewPresets.find(item => item.name === reviewPresetSelected);
      if (!selected) throw new Error("Preset not found");
      const renamed = validateReviewPreset({ ...selected, name });
      if (reviewPresets.some(item => item.name.toLowerCase() === name.toLowerCase() && item.name !== selected.name)) throw new Error("A preset already has that name");
      persistReviewPresets(reviewPresets.map(item => item.name === selected.name ? renamed : item));
      setReviewPresetSelected(name); setReviewPresetMessage(`Renamed preset to ${name}`);
    } catch (error) { setReviewPresetMessage(String(error)); }
  }
  function deleteReviewPreset() {
    if (!reviewPresetSelected || !window.confirm(`Delete preset "${reviewPresetSelected}"?`)) return;
    persistReviewPresets(reviewPresets.filter(item => item.name !== reviewPresetSelected));
    setReviewPresetSelected(""); setReviewPresetMessage("Preset deleted. Current filters are unchanged.");
  }
  function exportReviewPresets() {
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-review-focus-presets", schema: 1,
      exportedAt: new Date().toISOString(), presets: reviewPresets }, null, 2),
      "review-focus-presets.json", "application/json;charset=utf-8");
  }
  async function importReviewPresets(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 32768) throw new Error("Preset import exceeds 32 KB");
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid preset file");
      const backup = parsed as Record<string, unknown>;
      if (backup.format !== "tournament-review-focus-presets" || backup.schema !== 1 || !Array.isArray(backup.presets)) throw new Error("Unsupported preset format");
      if (backup.presets.length > 20) throw new Error("Import contains more than 20 presets");
      const incoming = backup.presets.map(validateReviewPreset);
      const names = incoming.map(item => item.name.toLowerCase());
      if (new Set(names).size !== names.length) throw new Error("Import contains duplicate preset names");
      const merged = [...reviewPresets];
      for (const preset of incoming) {
        const index = merged.findIndex(item => item.name.toLowerCase() === preset.name.toLowerCase());
        if (index >= 0) merged[index] = preset; else merged.push(preset);
      }
      if (merged.length > 20) throw new Error("Import would exceed 20 saved presets");
      if (!window.confirm(`Import ${incoming.length} preset(s)? Matching names will be replaced. No review records will change.`)) return;
      persistReviewPresets(merged); setReviewPresetMessage(`Imported ${incoming.length} preset(s).`);
    } catch (error) { setReviewPresetMessage(`Import rejected: ${String(error)}`); }
  }
  // Steps 234-243: browser-local owner workload and review handoff utilities.
  const [diagnosticOwnerOnlyOpen, setDiagnosticOwnerOnlyOpen] = useState(false);
  const [diagnosticOwnerOnlyHigh, setDiagnosticOwnerOnlyHigh] = useState(false);
  const [diagnosticOwnerOnlyUnnoted, setDiagnosticOwnerOnlyUnnoted] = useState(false);
  const [diagnosticOwnerSort, setDiagnosticOwnerSort] = useState<"existing" | "owner">("existing");
  const [diagnosticOwnerHandoffNote, setDiagnosticOwnerHandoffNote] = useState("");
  function selectOwnerReviewMatches(kind: "assigned" | "unassigned" | "overdue") {
    const cutoff = Date.now() - diagnosticReviewSlaDays * 86400000;
    const matches = filteredImportDiagnostics.filter(item => {
      const key = diagnosticKey(item);
      if (kind === "assigned") return Boolean(diagnosticReviewOwners[key]?.trim());
      if (kind === "unassigned") return !diagnosticReviewOwners[key]?.trim();
      return triageFor(key).status !== "resolved" && Date.parse(item.at) <= cutoff;
    }).map(diagnosticKey);
    setDiagnosticSelected(previous => Array.from(new Set([...previous, ...matches])));
    setDiagnosticBulkNotice(`Selected ${matches.length} ${kind} review(s).`);
  }
  function handoffSelectedDiagnosticReviews() {
    const owner = diagnosticReviewBulkOwner.trim();
    const keys = selectedImportDiagnostics.map(diagnosticKey);
    if (!owner || !keys.length) return;
    const note = diagnosticOwnerHandoffNote.trim().slice(0, 500);
    if (!window.confirm(`Assign ${keys.length} selected review(s) to ${owner}?${note ? " Add a handoff note?" : ""}`)) return;
    updateDiagnosticOwners(keys, owner);
    if (note) {
      const valid = new Set(importDiagnostics.map(diagnosticKey));
      setDiagnosticNotes(previous => {
        const next = { ...previous };
        for (const key of keys) if (valid.has(key)) next[key] = [previous[key], `Handoff to ${owner}: ${note}`].filter(Boolean).join(" | ").slice(0, 500);
        try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
        return next;
      });
    }
    setDiagnosticOwnerHandoffNote("");
  }
  function exportDiagnosticOwnerWorkload() {
    const records = filteredImportDiagnostics.map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, owner: diagnosticReviewOwners[diagnosticKey(item)] || "",
      ...triageFor(diagnosticKey(item)),
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-owner-workload", schema: 1,
      exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports,
      ownerOnlyOpen: diagnosticOwnerOnlyOpen, ownerOnlyHigh: diagnosticOwnerOnlyHigh,
      ownerOnlyUnnoted: diagnosticOwnerOnlyUnnoted, records }, null, 2),
      "threshold-import-owner-workload.json", "application/json;charset=utf-8");
  }
  const filteredImportDiagnostics = importDiagnostics.filter(item => {
    if (diagnosticFilter !== "all" && item.outcome !== diagnosticFilter) return false;
    if (diagnosticPinnedOnly && !diagnosticPinned.includes(diagnosticKey(item))) return false;
    const triage = triageFor(diagnosticKey(item));
    if (diagnosticTriageStatusFilter !== "all" && triage.status !== diagnosticTriageStatusFilter) return false;
    if (diagnosticTriagePriorityFilter !== "all" && triage.priority !== diagnosticTriagePriorityFilter) return false;
    if (diagnosticTriageOnlyOpen && triage.status === "resolved") return false;
    if (diagnosticTriageOnlyHigh && triage.priority !== "high") return false;
    if (diagnosticReviewAgeDays > 0 && Date.parse(item.at) > diagnosticReviewCutoff) return false;
    if (diagnosticReviewRejectedOnly && item.outcome !== "rejected") return false;
    if (diagnosticReviewMissingNotes && Boolean(diagnosticNotes[diagnosticKey(item)]?.trim())) return false;
    if (diagnosticReviewOverdueOnly && (triage.status === "resolved" || Date.parse(item.at) > Date.now() - diagnosticReviewSlaDays * 86400000)) return false;
    const owner = diagnosticReviewOwners[diagnosticKey(item)] || "";
    if (diagnosticReviewUnassignedOnly && owner.trim()) return false;
    if (diagnosticReviewOwnerFilter.trim() && !owner.toLowerCase().includes(diagnosticReviewOwnerFilter.trim().toLowerCase())) return false;
    if (diagnosticOwnerOnlyOpen && triage.status === "resolved") return false;
    if (diagnosticOwnerOnlyHigh && triage.priority !== "high") return false;
    if (diagnosticOwnerOnlyUnnoted && Boolean(diagnosticNotes[diagnosticKey(item)]?.trim())) return false;
    const note = diagnosticNotes[diagnosticKey(item)] || "";
    if (diagnosticNotesOnly && !note.trim()) return false;
    if (diagnosticNoteSearch.trim() && !note.toLowerCase().includes(diagnosticNoteSearch.trim().toLowerCase())) return false;
    if (diagnosticErrorsOnly && !item.error) return false;
    if (diagnosticFileFilter.trim() && !item.fileName.toLowerCase().includes(diagnosticFileFilter.trim().toLowerCase())) return false;
    if (diagnosticCheckFilter.trim() && !item.checks.some(check => check.toLowerCase().includes(diagnosticCheckFilter.trim().toLowerCase()))) return false;
    if (diagnosticMinBytes !== "" && item.bytes < Number(diagnosticMinBytes)) return false;
    if (diagnosticMaxBytes !== "" && item.bytes > Number(diagnosticMaxBytes)) return false;
    const query = diagnosticSearch.trim().toLowerCase();
    if (query && ![item.fileName, item.outcome, item.error || "", ...item.checks].join(" ").toLowerCase().includes(query)) return false;
    const timestamp = Date.parse(item.at);
    if (!Number.isFinite(timestamp)) return false;
    if (diagnosticFrom && timestamp < new Date(`${diagnosticFrom}T00:00:00`).getTime()) return false;
    if (diagnosticTo && timestamp > new Date(`${diagnosticTo}T23:59:59.999`).getTime()) return false;
    return true;
  }).sort((a, b) => diagnosticSort === "newest" ? Date.parse(b.at) - Date.parse(a.at) : Date.parse(a.at) - Date.parse(b.at));
  if (diagnosticReviewSort === "priority") {
    const weight = { high: 0, normal: 1, low: 2 };
    filteredImportDiagnostics.sort((a, b) => weight[triageFor(diagnosticKey(a)).priority] - weight[triageFor(diagnosticKey(b)).priority] || Date.parse(b.at) - Date.parse(a.at));
  }
  if (diagnosticOwnerSort === "owner") filteredImportDiagnostics.sort((a, b) =>
    (diagnosticReviewOwners[diagnosticKey(a)] || "\uffff").localeCompare(diagnosticReviewOwners[diagnosticKey(b)] || "\uffff") || Date.parse(b.at) - Date.parse(a.at));
  const diagnosticOwnerWorkload = filteredImportDiagnostics.reduce<Record<string, { total: number; open: number; overdue: number; high: number }>>((acc, item) => {
    const key = diagnosticKey(item);
    const owner = diagnosticReviewOwners[key]?.trim() || "(unassigned)";
    const triage = triageFor(key);
    const stats = acc[owner] || { total: 0, open: 0, overdue: 0, high: 0 };
    stats.total += 1;
    if (triage.status !== "resolved") { stats.open += 1; if (Date.parse(item.at) <= Date.now() - diagnosticReviewSlaDays * 86400000) stats.overdue += 1; }
    if (triage.priority === "high") stats.high += 1;
    acc[owner] = stats;
    return acc;
  }, {});
  const reviewFocusRows = filteredImportDiagnostics.filter(item => {
    const key = diagnosticKey(item);
    const owner = diagnosticReviewOwners[key]?.trim() || "";
    const triage = triageFor(key);
    if (reviewFocusOwner && !owner.toLowerCase().includes(reviewFocusOwner.toLowerCase().trim())) return false;
    if (reviewFocusPriority !== "all" && triage.priority !== reviewFocusPriority) return false;
    if (reviewFocusStatus !== "all" && triage.status !== reviewFocusStatus) return false;
    if (reviewFocusOnlyUnassigned && owner) return false;
    if (reviewFocusOnlyOverdue && (triage.status === "resolved" || Date.parse(item.at) > Date.now() - diagnosticReviewSlaDays * 86400000)) return false;
    return true;
  }).sort((a, b) => {
    if (reviewFocusSort === "priority") {
      const rank = { high: 0, normal: 1, low: 2 };
      const delta = rank[triageFor(diagnosticKey(a)).priority] - rank[triageFor(diagnosticKey(b)).priority];
      if (delta) return delta;
    }
    return Date.parse(a.at) - Date.parse(b.at);
  });
  const reviewFocusOpen = reviewFocusRows.filter(item => triageFor(diagnosticKey(item)).status !== "resolved").length;
  const reviewFocusHigh = reviewFocusRows.filter(item => triageFor(diagnosticKey(item)).priority === "high").length;
  const reviewFocusUnassigned = reviewFocusRows.filter(item => !diagnosticReviewOwners[diagnosticKey(item)]?.trim()).length;
  const diagnosticReviewOpenCount = filteredImportDiagnostics.filter(item => triageFor(diagnosticKey(item)).status !== "resolved").length;
  const diagnosticReviewOverdueCount = filteredImportDiagnostics.filter(item => triageFor(diagnosticKey(item)).status !== "resolved" && Date.parse(item.at) <= Date.now() - diagnosticReviewSlaDays * 86400000).length;
  const diagnosticReviewUnassignedCount = filteredImportDiagnostics.filter(item => !diagnosticReviewOwners[diagnosticKey(item)]?.trim()).length;
  const diagnosticReviewUnnotedCount = filteredImportDiagnostics.filter(item => !diagnosticNotes[diagnosticKey(item)]?.trim()).length;
  const diagnosticReviewOldest = filteredImportDiagnostics.reduce<number | null>((oldest, item) => {
    const at = Date.parse(item.at); return Number.isFinite(at) && (oldest === null || at < oldest) ? at : oldest;
  }, null);
  const diagnosticGroups = filteredImportDiagnostics.reduce<Record<string, number>>((acc, item) => {
    const group = diagnosticGroupBy === "filename" ? item.fileName : diagnosticGroupBy === "outcome" ? item.outcome : "All";
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});
  const selectedImportDiagnostics = importDiagnostics.filter(item => diagnosticSelected.includes(diagnosticKey(item)));
  const diagnosticSelectedMatching = filteredImportDiagnostics.filter(item => diagnosticSelected.includes(diagnosticKey(item))).length;
  const diagnosticSelectedRejected = selectedImportDiagnostics.filter(item => item.outcome === "rejected").length;
  const diagnosticSelectedPinned = selectedImportDiagnostics.filter(item => diagnosticPinned.includes(diagnosticKey(item))).length;
  const diagnosticAnnotatedCount = filteredImportDiagnostics.filter(item => Boolean(diagnosticNotes[diagnosticKey(item)]?.trim())).length;
  const diagnosticTriageCounts = filteredImportDiagnostics.reduce<Record<string, number>>((counts, item) => { const t = triageFor(diagnosticKey(item)); counts[`status:${t.status}`] = (counts[`status:${t.status}`] || 0) + 1; counts[`priority:${t.priority}`] = (counts[`priority:${t.priority}`] || 0) + 1; return counts; }, {});
  const diagnosticDays = filteredImportDiagnostics.reduce<Record<string, number>>((acc, item) => { const day = item.at.slice(0, 10); acc[day] = (acc[day] || 0) + 1; return acc; }, {});
  const diagnosticErrorTypes = filteredImportDiagnostics.filter(item => item.error).reduce<Record<string, number>>((acc, item) => { const type = (item.error || "").split(":")[0].slice(0, 80); acc[type] = (acc[type] || 0) + 1; return acc; }, {});
  function exportDiagnosticTriageSummary() {
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-triage", schema: 1, exportedAt: new Date().toISOString(), matching: filteredImportDiagnostics.length, annotated: diagnosticAnnotatedCount, byDay: diagnosticDays, byError: diagnosticErrorTypes }, null, 2), "threshold-import-triage.json", "application/json;charset=utf-8");
  }
  function exportDiagnosticNotes() {
    const records = filteredImportDiagnostics.filter(item => diagnosticNotes[diagnosticKey(item)]?.trim()).map(item => ({ at: item.at, outcome: item.outcome, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName, note: diagnosticNotes[diagnosticKey(item)] }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-operator-notes", schema: 1, exportedAt: new Date().toISOString(), records }, null, 2), "threshold-import-operator-notes.json", "application/json;charset=utf-8");
  }
  function exportSafeDiagnostic(item: ImportDiagnostic): ImportDiagnostic {
    const note = diagnosticIncludeNotesInExports ? diagnosticNotes[diagnosticKey(item)] : undefined;
    const result = { ...item, ...(note ? { operatorNote: note } : {}), triage: triageFor(diagnosticKey(item)) };
    return (diagnosticRedactExports ? { ...result, fileName: "[redacted]" } : result) as ImportDiagnostic;
  }
  function invertVisibleDiagnosticSelection() {
    const visible = new Set(visibleImportDiagnostics.map(diagnosticKey));
    setDiagnosticSelected(previous => Array.from(new Set([...previous.filter(key => !visible.has(key)), ...visibleImportDiagnostics.filter(item => !previous.includes(diagnosticKey(item))).map(diagnosticKey)])));
  }
  function selectDiagnosticSubset(kind: "rejected" | "pinned") {
    const matches = filteredImportDiagnostics.filter(item => kind === "rejected" ? item.outcome === "rejected" : diagnosticPinned.includes(diagnosticKey(item)));
    setDiagnosticSelected(previous => Array.from(new Set([...previous, ...matches.map(diagnosticKey)])));
    setDiagnosticBulkNotice(`Selected ${matches.length} matching ${kind} record(s).`);
  }
  function unpinSelectedDiagnostics() {
    const selected = new Set(diagnosticSelected);
    setDiagnosticPinned(previous => {
      const next = previous.filter(key => !selected.has(key));
      try { localStorage.setItem("tournament-threshold-import-pins-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice("Removed pins from selected records.");
  }
  function removeUnpinnedDiagnostics() {
    const pinned = new Set(diagnosticPinned);
    const count = importDiagnostics.filter(item => !pinned.has(diagnosticKey(item))).length;
    if (!count || !window.confirm(`Delete ${count} unpinned diagnostic record(s) from this browser?`)) return;
    setImportDiagnostics(previous => {
      const next = previous.filter(item => pinned.has(diagnosticKey(item)));
      try { localStorage.setItem("tournament-threshold-import-diagnostics-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticSelected([]); setDiagnosticPage(1);
    setDiagnosticBulkNotice(`Deleted ${count} unpinned record(s).`);
  }
  function pruneOrphanedDiagnosticPins() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = diagnosticPinned.filter(key => valid.has(key));
    const removed = diagnosticPinned.length - next.length;
    setDiagnosticPinned(next);
    try { localStorage.setItem("tournament-threshold-import-pins-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Removed ${removed} orphaned pin(s).`);
  }
  function exportSelectedDiagnosticsCsv() {
    if (!selectedImportDiagnostics.length) return;
    const csv = (value: unknown) => { const raw = String(value ?? ""); const safe = /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw; return `"${safe.replace(/"/g, '""')}"`; };
    const rows = selectedImportDiagnostics.map(exportSafeDiagnostic);
    const lines = [["Timestamp", "File", "Bytes", "Result", "Checks", "Error"].map(csv).join(","), ...rows.map(item => [item.at, item.fileName, item.bytes, item.outcome, item.checks.join("; "), item.error || ""].map(csv).join(","))];
    downloadDiagnosticFile(lines.join("\r\n"), "threshold-import-selected.csv", "text/csv;charset=utf-8");
  }
  function exportPinnedDiagnostics() {
    const rows = importDiagnostics.filter(item => diagnosticPinned.includes(diagnosticKey(item))).map(exportSafeDiagnostic);
    if (!rows.length) return;
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostics", schema: 1, exportedAt: new Date().toISOString(), pinnedOnly: true, filenamesRedacted: diagnosticRedactExports, records: rows }, null, 2), "threshold-import-pinned.json", "application/json;charset=utf-8");
  }

  function exportSelectedDiagnostics() {
    if (!selectedImportDiagnostics.length) return;
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostics", schema: 1, exportedAt: new Date().toISOString(), selection: true, filenamesRedacted: diagnosticRedactExports, records: selectedImportDiagnostics.map(exportSafeDiagnostic) }, null, 2), "threshold-import-selected.json", "application/json;charset=utf-8");
  }
  function deleteSelectedDiagnostics() {
    if (!selectedImportDiagnostics.length || !window.confirm(`Delete ${selectedImportDiagnostics.length} selected local diagnostic record(s)?`)) return;
    const selected = new Set(diagnosticSelected);
    setImportDiagnostics(previous => {
      const next = previous.filter(item => !selected.has(diagnosticKey(item)));
      try { localStorage.setItem("tournament-threshold-import-diagnostics-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticSelected([]);
    setDiagnosticPage(1);
  }
  const diagnosticCounts = { verified: filteredImportDiagnostics.filter(x => x.outcome === "verified").length, legacy: filteredImportDiagnostics.filter(x => x.outcome === "legacy").length, rejected: filteredImportDiagnostics.filter(x => x.outcome === "rejected").length };
  const diagnosticPageCount = Math.max(1, Math.ceil(filteredImportDiagnostics.length / diagnosticPageSize));
  const safeDiagnosticPage = Math.min(diagnosticPage, diagnosticPageCount);
  const visibleImportDiagnostics = filteredImportDiagnostics.slice((safeDiagnosticPage - 1) * diagnosticPageSize, safeDiagnosticPage * diagnosticPageSize);
  const diagnosticSuccessPercent = filteredImportDiagnostics.length ? Math.round((diagnosticCounts.verified + diagnosticCounts.legacy) * 100 / filteredImportDiagnostics.length) : null;
  const diagnosticUniqueFiles = new Set(filteredImportDiagnostics.map(item => item.fileName)).size;
  const diagnosticAverageBytes = filteredImportDiagnostics.length ? Math.round(filteredImportDiagnostics.reduce((sum, item) => sum + item.bytes, 0) / filteredImportDiagnostics.length) : null;
  const diagnosticTotalChecks = filteredImportDiagnostics.reduce((sum, item) => sum + item.checks.length, 0);
  const diagnosticLatestAttempt = importDiagnostics.length ? importDiagnostics.reduce((latest, item) => Date.parse(item.at) > Date.parse(latest.at) ? item : latest) : null;
  const diagnosticVisibleStart = filteredImportDiagnostics.length ? (safeDiagnosticPage - 1) * diagnosticPageSize + 1 : 0;
  const diagnosticVisibleEnd = Math.min(safeDiagnosticPage * diagnosticPageSize, filteredImportDiagnostics.length);
  function exportSingleDiagnostic(item: ImportDiagnostic) {
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostic", schema: 1, exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports, record: exportSafeDiagnostic(item) }, null, 2), `threshold-import-${item.outcome}-${item.at.replace(/[^0-9A-Za-z]/g, "-")}.json`, "application/json;charset=utf-8");
  }
  async function copySingleDiagnostic(item: ImportDiagnostic) {
    try {
      await navigator.clipboard.writeText([`Time: ${item.at}`, `File: ${item.fileName}`, `Size: ${item.bytes} bytes`, `Result: ${item.outcome}`, ...item.checks.map(check => `Check: ${check}`), ...(item.error ? [`Error: ${item.error}`] : [])].join("\n"));
      setDiagnosticCopyNotice(`Copied details for ${item.fileName}`);
    } catch { setDiagnosticCopyNotice("Clipboard unavailable. Use the individual JSON export instead."); }
  }
  function downloadDiagnosticFile(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportImportDiagnosticsJson() {
    // Include only the already-displayed metadata, never the imported configuration or its contents.
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostics", schema: 1, exportedAt: new Date().toISOString(), filters: { outcome: diagnosticFilter, search: diagnosticSearch, from: diagnosticFrom, to: diagnosticTo, minBytes: diagnosticMinBytes, maxBytes: diagnosticMaxBytes, errorsOnly: diagnosticErrorsOnly }, summary: diagnosticCounts, filenamesRedacted: diagnosticRedactExports, records: filteredImportDiagnostics.map(exportSafeDiagnostic) }, null, 2), "threshold-import-diagnostics.json", "application/json;charset=utf-8");
  }
  function exportDiagnosticSummary() {
    const count = filteredImportDiagnostics.length;
    const totalBytes = filteredImportDiagnostics.reduce((sum, item) => sum + item.bytes, 0);
    const report = { format: "tournament-threshold-import-diagnostic-summary", schema: 1, exportedAt: new Date().toISOString(), filters: { outcome: diagnosticFilter, search: diagnosticSearch, from: diagnosticFrom, to: diagnosticTo, minBytes: diagnosticMinBytes, maxBytes: diagnosticMaxBytes, errorsOnly: diagnosticErrorsOnly }, totals: { records: count, ...diagnosticCounts, accepted: diagnosticCounts.verified + diagnosticCounts.legacy, acceptancePercent: diagnosticSuccessPercent, totalFileBytes: totalBytes, averageFileBytes: count ? Math.round(totalBytes / count) : null } };
    downloadDiagnosticFile(JSON.stringify(report, null, 2), "threshold-import-summary.json", "application/json;charset=utf-8");
  }
  function exportDiagnosticMarkdown() {
    // Markdown contains metadata only, not imported configuration values.
    const lines = ["# Threshold backup import diagnostic report", "", `Generated: ${new Date().toISOString()}`, `Matching attempts: ${filteredImportDiagnostics.length}`, `Verified: ${diagnosticCounts.verified}`, `Legacy: ${diagnosticCounts.legacy}`, `Rejected: ${diagnosticCounts.rejected}`, `Acceptance: ${diagnosticSuccessPercent === null ? "N/A" : `${diagnosticSuccessPercent}%`}`, "", "## Records", ""];
    for (const item of filteredImportDiagnostics.map(exportSafeDiagnostic)) {
      lines.push(`### ${item.at} | ${item.outcome}`, `File: ${item.fileName.replace(/[\r\n]/g, " ")}`, `Size: ${item.bytes} bytes`, ...(diagnosticIncludeNotesInExports && diagnosticNotes[diagnosticKey(item)] ? [`- Operator note: ${diagnosticNotes[diagnosticKey(item)].replace(/[\r\n]/g, " ")}`] : []), ...item.checks.map(check => `- Passed: ${check.replace(/[\r\n]/g, " ")}`), ...(item.error ? [`- Error: ${item.error.replace(/[\r\n]/g, " ")}`] : []), "");
    }
    downloadDiagnosticFile(lines.join("\n"), "threshold-import-diagnostics.md", "text/markdown;charset=utf-8");
  }
  function recordImportDiagnostic(item: ImportDiagnostic) {
    setImportDiagnostics(previous => {
      const next = [item, ...previous].slice(0, 50);
      try { localStorage.setItem("tournament-threshold-import-diagnostics-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  function exportImportDiagnostics() {
    const rows = filteredImportDiagnostics.map(exportSafeDiagnostic);
    const csv = (value: unknown) => { const raw = String(value ?? ""); const safe = /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw; return `"${safe.replace(/"/g, '""')}"`; };
    const content = [["Timestamp", "File", "Bytes", "Result", "Checks", "Error"].map(csv).join(","), ...rows.map(item => [item.at, item.fileName, item.bytes, item.outcome, item.checks.join("; "), item.error ?? ""].map(csv).join(","))].join("\r\n");
    downloadDiagnosticFile(content, "threshold-import-diagnostics.csv", "text/csv;charset=utf-8");
  }

  const [importFileName, setImportFileName] = useState("");
  const [selectedImportFields, setSelectedImportFields] = useState<Array<keyof ReliabilityRules>>([]);
  const [rulesVersion, setRulesVersion] = useState<number | null>(null);
  const [rulesConflict, setRulesConflict] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const rulesDirtyRef = useRef(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesReady, setRulesReady] = useState(false);
  const rulesVersionRef = useRef<number | null>(null);
  useEffect(() => { rulesVersionRef.current = rulesVersion; }, [rulesVersion]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await requestNode("/api/captures/reliability-rules");
        if (!active) return;
        if (!rulesDirtyRef.current) { setReliabilityRules(response.rules); setRulesVersion(response.version); }
        else if (rulesVersionRef.current !== null && response.version !== rulesVersionRef.current) setRulesConflict(true);
        setRulesReady(true);
        try { const historyResponse = await requestNode("/api/captures/reliability-rules/history"); if (active) setRuleHistory(historyResponse.changes ?? []); } catch { /* history is supplementary */ }
        setRulesError(null);
      } catch (error) { if (active) setRulesError(String(error)); }
    };
    const timer = startPolling(poll, 10000);
    return () => { active = false; timer(); };
  }, [requestNode]);
  function editReliabilityRules(next: (previous: ReliabilityRules) => ReliabilityRules) {
    rulesDirtyRef.current = true; setRulesDirty(true); setReliabilityRules(next);
  }
  async function saveReliabilityRules() {
    if (rulesSaving || !rulesReady) return;
    setRulesSaving(true);
    try {
      const response = await requestNode("/api/captures/reliability-rules", { method: "PUT", headers: { "Content-Type": "application/json", "X-Operator-Note": encodeURIComponent(ruleNote.slice(0, 300)) }, body: JSON.stringify({ rules: reliabilityRules, version: rulesVersion }) });
      setReliabilityRules(response.rules); setRulesVersion(response.version); setRulesConflict(false); rulesDirtyRef.current = false; setRulesDirty(false); setRulesError(null); setRuleNote("");
      const historyResponse = await requestNode("/api/captures/reliability-rules/history"); setRuleHistory(historyResponse.changes ?? []);
    } catch (error) { setRulesError(String(error)); if (String(error).includes("409") || String(error).toLowerCase().includes("conflict") || String(error).includes("changed on another dashboard")) setRulesConflict(true); }
    finally { setRulesSaving(false); }
  }
  async function restoreHistoricalRules(changeId: string, snapshot: "before" | "after") {
    if (rulesSaving || rulesVersion === null) return;
    if (rulesDirty && !window.confirm("Discard unsaved threshold edits and restore a historical configuration?")) return;
    if (!window.confirm(`Restore the ${snapshot} configuration from this history entry? This creates a new audited version.`)) return;
    setRulesSaving(true);
    try {
      const response = await requestNode("/api/captures/reliability-rules/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId, snapshot, version: rulesVersion }) });
      setReliabilityRules(response.rules); setRulesVersion(response.version); setRulesConflict(false);
      rulesDirtyRef.current = false; setRulesDirty(false); setRulesError(null); setRuleNote("");
      const historyResponse = await requestNode("/api/captures/reliability-rules/history"); setRuleHistory(historyResponse.changes ?? []);
    } catch (error) {
      setRulesError(String(error));
      if (String(error).includes("409") || String(error).includes("changed on another dashboard")) setRulesConflict(true);
    } finally { setRulesSaving(false); }
  }
  // Step 135: SHA-256 detects accidental changes to the five canonical rule values.
  // It is an integrity checksum, not a digital signature or proof of who created a backup.
  function canonicalReliabilityRules(rules: ReliabilityRules): string {
    return JSON.stringify([rules.minAttempts, rules.warningSuccessRate, rules.criticalSuccessRate, rules.warningFailures, rules.criticalFailures]);
  }
  async function reliabilityRulesChecksum(rules: ReliabilityRules): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable. Use localhost or a secure HTTPS connection.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalReliabilityRules(rules)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  // Step 133/135: Portable JSON backup with verifiable rule-value checksum.
  async function exportReliabilityRules() {
    if (!rulesReady || rulesVersion === null) return;
    try {
      const payload = { format: "tournament-reliability-thresholds", schemaVersion: 2, exportedAt: new Date().toISOString(), sourceVersion: rulesVersion, rules: reliabilityRules, integrity: { algorithm: "SHA-256", checksum: await reliabilityRulesChecksum(reliabilityRules) } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `reliability-thresholds-v${rulesVersion}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setRulesError(`Export failed: ${String(error)}`); }
  }
  function validateImportedRules(value: unknown): ReliabilityRules {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid rules object");
    const data = value as Record<string, unknown>;
    const ranges: Record<keyof ReliabilityRules, [number, number]> = { minAttempts: [1, 100], warningSuccessRate: [0, 100], criticalSuccessRate: [0, 100], warningFailures: [1, 100], criticalFailures: [1, 100] };
    const result = {} as ReliabilityRules;
    for (const key of Object.keys(ranges) as Array<keyof ReliabilityRules>) {
      const n = data[key]; const [min, max] = ranges[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}: expected integer ${min}-${max}`);
      result[key] = n;
    }
    if (result.criticalSuccessRate > result.warningSuccessRate || result.criticalFailures < result.warningFailures) throw new Error("Critical thresholds must be at least as severe as warning thresholds");
    return result;
  }
  async function previewReliabilityImport(file: File | undefined) {
    setImportedRules(null); setImportFileName(""); setSelectedImportFields([]); setImportIntegrityStatus(null); setRulesError(null);
    if (!file) return;
    const checks: string[] = [];
    try {
      if (file.size > 65536) throw new Error("Import file exceeds 64 KB");
      checks.push("File size within 64 KB limit");
      const parsed: unknown = JSON.parse(await file.text());
      checks.push("Valid JSON syntax");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid backup file");
      const backup = parsed as Record<string, unknown>;
      if (backup.format !== "tournament-reliability-thresholds" || (backup.schemaVersion !== 1 && backup.schemaVersion !== 2)) throw new Error("Unsupported backup format or schema version");
      checks.push(`Supported schema version ${backup.schemaVersion}`);
      const validated = validateImportedRules(backup.rules);
      checks.push("All five rule fields valid and thresholds consistent");
      let outcome: ImportDiagnostic["outcome"] = "legacy";
      if (backup.schemaVersion === 2) {
        const integrity = backup.integrity;
        if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) throw new Error("Missing backup integrity information");
        const record = integrity as Record<string, unknown>;
        if (record.algorithm !== "SHA-256" || typeof record.checksum !== "string" || !/^[a-f0-9]{64}$/.test(record.checksum)) throw new Error("Invalid SHA-256 checksum format");
        checks.push("SHA-256 checksum format valid");
        if (await reliabilityRulesChecksum(validated) !== record.checksum) throw new Error("SHA-256 mismatch: backup threshold values were modified or corrupted");
        checks.push("SHA-256 checksum matches rule values");
        outcome = "verified";
        setImportIntegrityStatus("SHA-256 verified: threshold values match the exported checksum. This does not authenticate the backup source.");
      } else {
        checks.push("Legacy backup: no checksum available");
        setImportIntegrityStatus("Legacy backup (schema 1): values validated, but no integrity checksum is available.");
      }
      setImportedRules(validated); setImportFileName(file.name);
      setSelectedImportFields((Object.keys(validated) as Array<keyof ReliabilityRules>).filter(key => validated[key] !== reliabilityRules[key]));
      recordImportDiagnostic({ at: new Date().toISOString(), fileName: file.name, bytes: file.size, outcome, checks });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRulesError(`Import rejected: ${message}`);
      recordImportDiagnostic({ at: new Date().toISOString(), fileName: file.name, bytes: file.size, outcome: "rejected", checks, error: message });
    }
  }
  // Step 134: Restore only selected fields. Validate the merged result before editing.
  const mergedImportRules = importedRules ? ({ ...reliabilityRules, ...Object.fromEntries(selectedImportFields.map(key => [key, importedRules[key]])) } as ReliabilityRules) : null;
  let importMergeError: string | null = null;
  if (mergedImportRules) {
    try { validateImportedRules(mergedImportRules); } catch (error) { importMergeError = String(error); }
  }
  function applyReliabilityImport() {
    if (!mergedImportRules || !selectedImportFields.length || importMergeError || !rulesReady || rulesConflict || rulesSaving) return;
    if (!window.confirm(`Apply ${selectedImportFields.length} selected threshold field(s) to the editor? Shared settings will not change until saved.`)) return;
    editReliabilityRules(() => ({ ...mergedImportRules })); setImportedRules(null); setImportFileName(""); setSelectedImportFields([]);
    setRuleNote(previous => previous || "Selective restoration from threshold backup");
  }
  async function reloadReliabilityRules() {
    try {
      const response = await requestNode("/api/captures/reliability-rules");
      setReliabilityRules(response.rules); setRulesVersion(response.version);
      rulesDirtyRef.current = false; setRulesDirty(false); setRulesConflict(false); setRulesError(null);
    } catch (error) { setRulesError(String(error)); }
  }
  const recoveryStatistics = useMemo(() => {
    const durationMs = statisticsWindow === "24h" ? 86400000 : statisticsWindow === "7d" ? 604800000 : 2592000000;
    const cutoff = Date.now() - durationMs;
    const windowEntries = audit.filter(entry => Number.isFinite(Date.parse(entry.at)) && Date.parse(entry.at) >= cutoff && Date.parse(entry.at) <= Date.now());
    const count = (type: RecoveryAuditEntry["type"]) => windowEntries.filter(entry => entry.type === type).length;
    const successes = count("success");
    const failures = count("failure");
    const cameras = new Map<string, { cameraId: string; successes: number; failures: number }>();
    for (const entry of windowEntries) {
      if (entry.type !== "success" && entry.type !== "failure") continue;
      const camera = cameras.get(entry.cameraId) ?? { cameraId: entry.cameraId, successes: 0, failures: 0 };
      if (entry.type === "success") camera.successes++;
      else camera.failures++;
      cameras.set(entry.cameraId, camera);
    }
    const daily = new Map<string, { day: string; successes: number; failures: number }>();
    for (const entry of windowEntries) {
      if (entry.type !== "success" && entry.type !== "failure") continue;
      const day = new Date(entry.at).toLocaleDateString("en-CA");
      const bucket = daily.get(day) ?? { day, successes: 0, failures: 0 };
      if (entry.type === "success") bucket.successes++;
      else bucket.failures++;
      daily.set(day, bucket);
    }
    return { successes, failures, acknowledged: count("acknowledged"), resolved: count("resolved"), reopened: count("reopened"),
      cameras: [...cameras.values()].sort((a, b) => b.failures - a.failures || a.cameraId.localeCompare(b.cameraId)),
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
      successRate: successes + failures ? Math.round(successes * 1000 / (successes + failures)) / 10 : null };
  }, [audit, statisticsWindow]);
  const reliabilityWarnings = useMemo(() => {
    return recoveryStatistics.cameras.flatMap(camera => {
      const attempts = camera.successes + camera.failures;
      if (attempts < reliabilityRules.minAttempts) return [];
      const rate = camera.successes * 100 / attempts;
      const critical = camera.failures >= reliabilityRules.criticalFailures || rate < reliabilityRules.criticalSuccessRate;
      const warning = camera.failures >= reliabilityRules.warningFailures || rate < reliabilityRules.warningSuccessRate;
      if (!critical && !warning) return [];
      return [{ cameraId: camera.cameraId, severity: critical ? "Critical" : "Warning", attempts, failures: camera.failures, rate: Math.round(rate) }];
    }).sort((a, b) => (a.severity === "Critical" ? 0 : 1) - (b.severity === "Critical" ? 0 : 1) || b.failures - a.failures);
  }, [recoveryStatistics, reliabilityRules]);
  // Browser-local transition history. A new audit attempt (or a changed threshold/window)
  // is required before recording another snapshot; the 10-second poll alone adds nothing.
  type ReliabilityHistoryItem = { at: string; cameraId: string; from: string; to: string; attempts: number; failures: number; rate: number; reason: string };
  const [reliabilityHistory, setReliabilityHistory] = useState<ReliabilityHistoryItem[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("tournament-recovery-warning-history:v1") || "[]");
      return Array.isArray(saved) ? saved.filter((item): item is ReliabilityHistoryItem => !!item && typeof item.cameraId === "string" && typeof item.at === "string" && typeof item.to === "string" && typeof item.from === "string").slice(0, 250) : [];
    } catch { return []; }
  });
  const [sharedWarningsReady, setSharedWarningsReady] = useState(false);
  const reliabilityFingerprint = useMemo(() => JSON.stringify({
    window: statisticsWindow, rules: reliabilityRules,
    attempts: audit.filter(entry => entry.type === "failure" || entry.type === "success")
      .map(entry => `${entry.at}|${entry.cameraId}|${entry.type}`).sort()
  }), [audit, statisticsWindow, reliabilityRules]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await requestNode("/api/captures/reliability-warnings");
        if (!active) return;
        const entries = Array.isArray(response.events) ? response.events : [];
        setReliabilityHistory(entries.map((e: any) => ({ at: e.at, cameraId: e.cameraId, from: e.from, to: e.to, attempts: e.attempts, failures: e.failures, rate: e.rate, reason: e.reason })));
        setReliabilityReviews(Object.fromEntries(entries.filter((e: any) => e.acknowledgedAt).map((e: any) => [e.key, { acknowledgedAt: e.acknowledgedAt, note: e.note }] )));
        setSharedWarningsReady(true);
      } catch { if (active) setSharedWarningsReady(false); }
    };
    const timer = startPolling(refresh, 10000);
    return () => { active = false; timer(); };
  }, [requestNode]);
  const reliabilityPrevious = useRef<{ fingerprint: string; states: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!audit.length) return;
    const current: Record<string, string> = {};
    for (const camera of recoveryStatistics.cameras) current[camera.cameraId] = "Normal";
    for (const warning of reliabilityWarnings) current[warning.cameraId] = warning.severity;
    const previous = reliabilityPrevious.current;
    if (previous?.fingerprint === reliabilityFingerprint) return;
    reliabilityPrevious.current = { fingerprint: reliabilityFingerprint, states: current };
    // The first observation establishes a baseline rather than inventing a transition.
    if (!previous) return;
    const changes: ReliabilityHistoryItem[] = [];
    for (const cameraId of new Set([...Object.keys(previous.states), ...Object.keys(current)])) {
      const from = previous.states[cameraId] ?? "Normal";
      const to = current[cameraId] ?? "Normal";
      if (from === to) continue;
      const warning = reliabilityWarnings.find(item => item.cameraId === cameraId);
      changes.push({ at: new Date().toISOString(), cameraId, from, to,
        attempts: warning?.attempts ?? 0, failures: warning?.failures ?? 0, rate: warning?.rate ?? 0,
        reason: to === "Normal" ? "Returned below warning thresholds or left reporting window" :
          to === "Critical" && from === "Warning" ? "Escalated from warning to critical" : "Threshold state changed" });
    }
    if (changes.length && sharedWarningsReady) {
      void Promise.all(changes.map(change => requestNode("/api/captures/reliability-warnings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) })))
        .then(() => requestNode("/api/captures/reliability-warnings"))
        .then(response => { setReliabilityHistory((response.events ?? []).map((e: any) => ({ at: e.at, cameraId: e.cameraId, from: e.from, to: e.to, attempts: e.attempts, failures: e.failures, rate: e.rate, reason: e.reason }))); })
        .catch(error => setError(String(error)));
    }
  }, [reliabilityFingerprint, reliabilityWarnings, recoveryStatistics.cameras, audit.length, sharedWarningsReady]);
  useEffect(() => {
    try { localStorage.setItem("tournament-recovery-warning-history:v1", JSON.stringify(reliabilityHistory)); }
    catch { /* storage unavailable */ }
  }, [reliabilityHistory]);
  // Step 127: browser-local operator reviews, keyed to immutable warning transition identity.
  type ReliabilityReview = { acknowledgedAt: string; note: string };
  const [reliabilityReviews, setReliabilityReviews] = useState<Record<string, ReliabilityReview>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("tournament-recovery-warning-reviews:v1") || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => {
        const review = value as Partial<ReliabilityReview> | null;
        return review && typeof review.acknowledgedAt === "string" && typeof review.note === "string";
      })) as Record<string, ReliabilityReview>;
    } catch { return {}; }
  });
  const reliabilityReviewKey = (item: ReliabilityHistoryItem) => JSON.stringify([item.at, item.cameraId, item.from, item.to]);
  useEffect(() => {
    try { localStorage.setItem("tournament-recovery-warning-reviews:v1", JSON.stringify(reliabilityReviews)); }
    catch { /* storage unavailable */ }
  }, [reliabilityReviews]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [historyReviewFilter, setHistoryReviewFilter] = useState("all");
  async function acknowledgeReliabilityWarning(item: ReliabilityHistoryItem) {
    const key = reliabilityReviewKey(item);
    if (reliabilityReviews[key]) return;
    const note = (reviewNotes[key] || "").trim();
    if (!note || note.length > 1000) return;
    try {
      const response = await requestNode("/api/captures/reliability-warnings/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, note }) });
      setReliabilityReviews(previous => ({ ...previous, [key]: { acknowledgedAt: response.event.acknowledgedAt, note: response.event.note } }));
      setReviewNotes(previous => { const next = { ...previous }; delete next[key]; return next; });
    } catch (error) { setError(String(error)); }
  }
  const [historyFilter, setHistoryFilter] = useState("all");
  const visibleReliabilityHistory = reliabilityHistory.filter(item => (historyFilter === "all" || item.to === historyFilter) && (historyReviewFilter === "all" || (historyReviewFilter === "reviewed" ? !!reliabilityReviews[reliabilityReviewKey(item)] : !reliabilityReviews[reliabilityReviewKey(item)])));
  function exportReliabilityHistory() {
    const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [["Timestamp", "Camera", "Previous state", "New state", "Attempts", "Failures", "Success rate (%)", "Reason", "Acknowledged at", "Operator note"],
      ...visibleReliabilityHistory.map(item => [item.at, item.cameraId, item.from, item.to, item.attempts, item.failures, item.rate, item.reason, reliabilityReviews[reliabilityReviewKey(item)]?.acknowledgedAt ?? "", reliabilityReviews[reliabilityReviewKey(item)]?.note ?? ""])];
    const blob = new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `recovery-reliability-warnings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filteredAudit = audit.filter(entry => {
    const search = auditSearch.trim().toLowerCase();
    const timestamp = Date.parse(entry.at);
    return (auditType === "all" || entry.type === auditType) &&
      (!search || `${entry.cameraId} ${entry.type} ${entry.detail}`.toLowerCase().includes(search)) &&
      (!auditFrom || (Number.isFinite(timestamp) && timestamp >= new Date(`${auditFrom}T00:00:00`).getTime())) &&
      (!auditTo || (Number.isFinite(timestamp) && timestamp <= new Date(`${auditTo}T23:59:59.999`).getTime()));
  });
  function exportAuditCsv() {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [["Timestamp", "Camera ID", "Event Type", "Detail"],
      ...filteredAudit.map(entry => [entry.at, entry.cameraId, entry.type, entry.detail])];
    const csv = "\uFEFF" + rows.map(row => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `capture-recovery-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const [escalations, setEscalations] = useState<RecoveryEscalationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const refresh = async () => {
    try {
      const [nextStatus, nextEvents, nextPolicy, nextEscalations, nextAudit] = await Promise.all([
        requestNode("/api/captures/recovery-status"),
        requestNode("/api/captures/recovery-events"),
        requestNode("/api/captures/recovery-policy"), requestNode("/api/captures/recovery-escalations"), requestNode("/api/captures/recovery-audit")
      ]);
      setStatus(nextStatus); setEvents(nextEvents.events ?? []); setPolicy(nextPolicy); setEscalations(nextEscalations); setAudit(nextAudit.events ?? []);
      setError(null); setLastUpdate(new Date().toLocaleTimeString());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [s, e, p, x, auditResponse] = await Promise.all([
          requestNode("/api/captures/recovery-status"), requestNode("/api/captures/recovery-events"), requestNode("/api/captures/recovery-policy"), requestNode("/api/captures/recovery-escalations"), requestNode("/api/captures/recovery-audit")
        ]);
        if (alive) { setStatus(s); setEvents(e.events ?? []); setPolicy(p); setEscalations(x); setAudit(auditResponse.events ?? []); setError(null); setLastUpdate(new Date().toLocaleTimeString()); }
      } catch (cause) { if (alive) setError(String(cause)); }
    };
    const timer = startPolling(poll, 10000);
    return () => { alive = false; timer(); };
  }, [requestNode]);
  async function restart(camera: RecoveryCameraStatus) {
    if (!window.confirm(`Restart capture for ${camera.cameraId}? This stops capture and starts a new recording segment. Active YouTube streams are protected.`)) return;
    setBusy(camera.cameraId);
    try {
      await requestNode(`/api/captures/${encodeURIComponent(camera.cameraId)}/recover`, { method: "POST" });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  async function resolveIncident(cameraId: string) {
    const note = window.prompt(`Resolution note for ${cameraId} (required):`);
    if (!note?.trim()) return;
    setBusy(`resolve:${cameraId}`);
    try {
      await requestNode(`/api/captures/recovery-incidents/${encodeURIComponent(cameraId)}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: note.trim() })
      });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  async function acknowledgeFailures(keys: string[]) {
    if (!keys.length) return;
    setBusy("acknowledge");
    try {
      await requestNode("/api/captures/recovery-events/acknowledge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys })
      });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  async function updatePolicy() {
    if (!policy || savingPolicy) return;
    if (policy.enabled && !window.confirm("Enable unattended camera capture restarts? Recording segments may split. Active YouTube streams remain protected.")) return;
    setSavingPolicy(true);
    try {
      const saved = await requestNode("/api/captures/recovery-policy", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy)
      });
      setPolicy(saved);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSavingPolicy(false); }
  }
  return <section className="overview" aria-label="Capture recovery controls">
    <h2>Capture Recovery</h2>
    <p className="muted">Manual restarts are restricted by stream protection, cooldowns, and attempt limits. Automatic recovery is {status?.automaticEnabled ? "enabled" : "disabled"}.</p>
    <details className="compact-collapsible"><summary>Automatic recovery policy</summary>
      {policy && <div className="bulk-results">
        <label><input type="checkbox" checked={policy.enabled} onChange={e => setPolicy({ ...policy, enabled: e.target.checked })} /> Enable unattended recovery</label>
        <label>Consecutive unhealthy checks <input type="number" min={3} max={12} value={policy.unhealthyChecks} onChange={e => setPolicy({ ...policy, unhealthyChecks: Number(e.target.value) })} /></label>
        <label>Minimum capture age (seconds) <input type="number" min={30} max={600} value={policy.minimumCaptureAgeSeconds} onChange={e => setPolicy({ ...policy, minimumCaptureAgeSeconds: Number(e.target.value) })} /></label>
        <p className="muted">YouTube streams are always protected. Recovery remains limited to two attempts per hour per camera with a five-minute cooldown.</p>
        <button type="button" disabled={savingPolicy} onClick={() => void updatePolicy()}>{savingPolicy ? "Saving..." : "Save recovery policy"}</button>
      </div>}
    </details>
    <button type="button" onClick={() => void refresh()}>Refresh recovery status</button>
    {lastUpdate && <span className="muted"> Updated: {lastUpdate}</span>}
    {error && <p role="alert">{error}</p>}
    {status?.cameras.length === 0 && <p>No active captures.</p>}
    {status?.cameras.map(camera => <div className="bulk-results" key={camera.cameraId}>
      <p><strong>{camera.cameraId}</strong></p>
      <p>Status: {camera.restarting ? "Restarting" : camera.streaming ? "Streaming (protected)" : camera.allowed ? "Eligible for restart" : camera.reason || "Unavailable"}</p>
      <p>Recovery attempts (last hour): {camera.attemptsInLastHour} / {status.maxAttemptsPerHour} | Cooldown: {Math.ceil(camera.cooldownRemainingMs / 1000)}s | Recording: {camera.recordingEnabled ? "On" : "Off"}</p>
      {camera.lastResult && <p>{camera.lastResult}</p>}
      <button type="button" disabled={!camera.allowed || busy !== null} onClick={() => void restart(camera)}>{busy === camera.cameraId ? "Restarting..." : "Restart capture"}</button>
    </div>)}
    <details className="compact-collapsible"><summary>Repeated-failure escalation ({escalations?.escalations.filter(item => item.incidentStatus === "open").length ?? 0} open)</summary>
      <p className="muted">A critical escalation appears after {escalations?.threshold ?? 3} failed recovery attempts for one camera within {escalations?.windowMinutes ?? 60} minutes. This is monitoring only and never bypasses stream protection or restart limits.</p>
      {escalations?.escalations.map(item => <div className="bulk-results" key={item.cameraId} role="alert">
        <p><strong>{item.incidentStatus === "resolved" ? "Resolved" : "Critical"}: {item.cameraId}</strong> | {item.failuresInWindow} failures in the last hour</p>
        <p>First: {new Date(item.firstFailureAt).toLocaleString()} | Latest: {new Date(item.lastFailureAt).toLocaleString()} | Unacknowledged: {item.unacknowledgedFailures}</p>
        <p>{item.latestDetail}</p>
        {item.incidentStatus === "resolved" ? <p className="muted">Resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : ""}: {item.resolutionNote}. A new failure will reopen this incident.</p> :
          <button type="button" disabled={busy !== null} onClick={() => void resolveIncident(item.cameraId)}>{busy === `resolve:${item.cameraId}` ? "Resolving..." : "Resolve incident"}</button>}
      </div>)}
      {escalations && escalations.escalations.length === 0 && <p>No cameras currently meet the escalation threshold.</p>}
    </details>
    <details className="compact-collapsible"><summary>Operator notifications ({events.filter(e => e.outcome === "failure" && !e.acknowledgedAt).length} unacknowledged)</summary>
      <p className="muted">Acknowledgement marks a failed restart as reviewed. It does not restart cameras or change recovery safeguards.</p>
      {events.some(e => e.outcome === "failure" && !e.acknowledgedAt) && <button type="button" disabled={busy !== null} onClick={() => void acknowledgeFailures(events.filter(e => e.outcome === "failure" && !e.acknowledgedAt).map(recoveryEventKey))}>Acknowledge all failures</button>}
      {events.filter(e => e.outcome === "failure").slice(0, 25).map((event, i) => <div className="bulk-results" key={`${recoveryEventKey(event)}-${i}`}>
        <p>{new Date(event.at).toLocaleString()}: {event.cameraId}: {event.detail}</p>
        {event.acknowledgedAt ? <p className="muted">Acknowledged {new Date(event.acknowledgedAt).toLocaleString()}</p> :
          <button type="button" disabled={busy !== null} onClick={() => void acknowledgeFailures([recoveryEventKey(event)])}>Acknowledge</button>}
      </div>)}
      {!events.some(e => e.outcome === "failure") && <p>No recovery failures recorded.</p>}
    </details>
    <details className="compact-collapsible"><summary>Recovery incident statistics and reliability trends</summary>
      <p className="muted">Statistics use retained audit records only (up to 2,000 events), not continuous camera uptime. Success rate measures recovery attempts, not stream availability. Older records may have been pruned.</p>
      <label>Reporting period <select value={statisticsWindow} onChange={e => setStatisticsWindow(e.target.value as "24h" | "7d" | "30d")}>
        <option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
      </select></label>
      <div className="bulk-results">
        <p><strong>Recovery attempts:</strong> {recoveryStatistics.successes + recoveryStatistics.failures} | <strong>Successful:</strong> {recoveryStatistics.successes} | <strong>Failed:</strong> {recoveryStatistics.failures}</p>
        <p><strong>Attempt success rate:</strong> {recoveryStatistics.successRate === null ? "N/A (no attempts)" : `${recoveryStatistics.successRate}%`}</p>
        <p><strong>Acknowledgements:</strong> {recoveryStatistics.acknowledged} | <strong>Resolutions:</strong> {recoveryStatistics.resolved} | <strong>Reopenings:</strong> {recoveryStatistics.reopened}</p>
      </div>
      <details className="compact-collapsible"><summary>Proactive reliability warnings ({reliabilityWarnings.length})</summary>
        <p className="muted">Warnings use retained recovery-attempt audit events in the selected reporting period. They are informational and never trigger camera restarts. Thresholds are shared through the backend. Save changes to synchronize dashboards.</p>
        <div className="bulk-results">
          <label>Minimum attempts before evaluation <input type="number" min={1} max={100} value={reliabilityRules.minAttempts} onChange={e => editReliabilityRules(r => ({ ...r, minAttempts: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} /></label>
          <label>Warning below success rate (%) <input type="number" min={0} max={100} value={reliabilityRules.warningSuccessRate} onChange={e => editReliabilityRules(r => ({ ...r, warningSuccessRate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} /></label>
          <label>Critical below success rate (%) <input type="number" min={0} max={100} value={reliabilityRules.criticalSuccessRate} onChange={e => editReliabilityRules(r => ({ ...r, criticalSuccessRate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} /></label>
          <label>Warning at failed attempts <input type="number" min={1} max={100} value={reliabilityRules.warningFailures} onChange={e => editReliabilityRules(r => ({ ...r, warningFailures: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} /></label>
          <label>Critical at failed attempts <input type="number" min={1} max={100} value={reliabilityRules.criticalFailures} onChange={e => editReliabilityRules(r => ({ ...r, criticalFailures: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} /></label>
        </div>
        <label>Change reason (optional) <input type="text" maxLength={300} value={ruleNote} onChange={e => setRuleNote(e.target.value)} placeholder="Reason for threshold change" /></label>
        <button type="button" disabled={!rulesDirty || rulesSaving || !rulesReady || rulesConflict || rulesVersion === null} onClick={() => void saveReliabilityRules()}>{rulesSaving ? "Saving..." : "Save shared thresholds"}</button>
        <p className="muted">Shared configuration version: {rulesVersion ?? "loading"}</p>
        {rulesConflict && <p role="alert">Another dashboard changed these thresholds. Reload shared settings to resolve the conflict. Your unsaved draft will be discarded.</p>}
        <button type="button" onClick={() => void reloadReliabilityRules()} disabled={rulesSaving}>Reload shared thresholds</button>
        {rulesDirty && <p className="muted">Unsaved changes are visible only here until saved.</p>}
        {rulesError && <p role="alert">Threshold sync: {rulesError}</p>}
        {!rulesReady && <p className="muted">Loading shared thresholds...</p>}
        <details className="compact-collapsible"><summary>Threshold backup and import/export</summary>
          <p className="muted">Export the current editor values with a SHA-256 integrity checksum. Imports verify schema 2 checksums; legacy schema 1 backups are accepted but unverified. A checksum does not prove the backup is trusted. Importing previews and validates a backup without modifying shared settings. Apply to the editor, then save using the current configuration version.</p>
          <button type="button" disabled={!rulesReady || rulesVersion === null} onClick={() => void exportReliabilityRules()}>Export threshold JSON</button>
          <label>Import threshold JSON <input type="file" accept=".json,application/json" onChange={e => void previewReliabilityImport(e.target.files?.[0])} /></label>
          <details className="compact-collapsible"><summary>Backup validation diagnostics ({importDiagnostics.length})</summary>
            <p className="muted">Steps 136-138: View validation checkpoints, failure reasons and recent import attempts. This browser retains the latest 50 attempts, including file names. No file contents are stored. History is local to this browser and is not an authenticated audit trail.</p>
            <p className="muted">Operator review tools: pinned records and selection are local to this browser. Pins are bookmarks, not immutable audit records.</p>
            <label><input type="checkbox" checked={diagnosticPinnedOnly} onChange={e => { setDiagnosticPinnedOnly(e.target.checked); setDiagnosticPage(1); }} /> Pinned only</label>
            <label>Group summary <select value={diagnosticGroupBy} onChange={e => setDiagnosticGroupBy(e.target.value as "none" | "outcome" | "filename")}><option value="none">All records</option><option value="outcome">By outcome</option><option value="filename">By filename</option></select></label>
            {diagnosticGroupBy !== "none" && <div className="bulk-results">{Object.entries(diagnosticGroups).sort((a, b) => b[1] - a[1]).map(([group, count]) => <p key={group}>{group}: {count}</p>)}</div>}
            <p className="muted">Selected: {selectedImportDiagnostics.length} | Pinned: {importDiagnostics.filter(item => diagnosticPinned.includes(diagnosticKey(item))).length}</p>
            <p className="muted">Selected matching filters: {diagnosticSelectedMatching} | Selected rejected: {diagnosticSelectedRejected} | Selected pinned: {diagnosticSelectedPinned}</p>
            <details className="compact-collapsible"><summary>Operator triage and priority</summary>
              <p className="muted">Browser-local review labels only. These do not resolve backend incidents or change stream health.</p>
              <label>Status filter <select value={diagnosticTriageStatusFilter} onChange={e => { setDiagnosticTriageStatusFilter(e.target.value); setDiagnosticPage(1); }}><option value="all">All statuses</option><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
              <label>Priority filter <select value={diagnosticTriagePriorityFilter} onChange={e => { setDiagnosticTriagePriorityFilter(e.target.value); setDiagnosticPage(1); }}><option value="all">All priorities</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              <p className="muted">Matching triage: New {diagnosticTriageCounts["status:new"] || 0} | Investigating {diagnosticTriageCounts["status:investigating"] || 0} | Resolved {diagnosticTriageCounts["status:resolved"] || 0} | High priority {diagnosticTriageCounts["priority:high"] || 0}</p>
              <label><input type="checkbox" checked={diagnosticTriageOnlyOpen} onChange={e => { setDiagnosticTriageOnlyOpen(e.target.checked); setDiagnosticPage(1); }} /> Open reviews only (204)</label>
              <label><input type="checkbox" checked={diagnosticTriageOnlyHigh} onChange={e => { setDiagnosticTriageOnlyHigh(e.target.checked); setDiagnosticPage(1); }} /> High-priority reviews only (205)</label>
              <button type="button" onClick={() => selectDiagnosticTriageMatches(t => t.status === "new")}>Select new reviews (206)</button>{" "}
              <button type="button" onClick={() => selectDiagnosticTriageMatches(t => t.status === "investigating")}>Select investigating (207)</button>{" "}
              <button type="button" onClick={() => selectDiagnosticTriageMatches(t => t.priority === "high")}>Select high priority (208)</button>{" "}
              <button type="button" onClick={() => { setDiagnosticTriageOnlyOpen(true); setDiagnosticTriageOnlyHigh(true); setDiagnosticPage(1); }}>Focus open high-priority (209)</button>{" "}
              <button type="button" onClick={() => { setDiagnosticTriageOnlyOpen(false); setDiagnosticTriageOnlyHigh(false); setDiagnosticTriageStatusFilter("all"); setDiagnosticTriagePriorityFilter("all"); setDiagnosticPage(1); }}>Reset triage filters (210)</button>
              <label>Review export limit (211) <select value={diagnosticTriageReportLimit} onChange={e => setDiagnosticTriageReportLimit(Number(e.target.value))}><option value={10}>10 records</option><option value={25}>25 records</option><option value={50}>50 records</option></select></label>
              <label><input type="checkbox" checked={diagnosticTriageReportIncludeNotes} onChange={e => setDiagnosticTriageReportIncludeNotes(e.target.checked)} /> Include operator notes in review exports (212)</label>
              <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticTriageCsv}>Export review CSV (213)</button>{" "}
              <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticTriageReviewJson}>Export review JSON</button>
              <details className="compact-collapsible"><summary>Review queue and aging</summary>
                <p className="muted">Review aging uses the import timestamp, not the time a triage label was changed. All data remains browser-local.</p>
                <label>Minimum record age (214) <select value={diagnosticReviewAgeDays} onChange={e => { setDiagnosticReviewAgeDays(Number(e.target.value)); setDiagnosticPage(1); }}><option value={0}>Any age</option><option value={1}>1+ days</option><option value={7}>7+ days</option><option value={30}>30+ days</option></select></label>
                <label><input type="checkbox" checked={diagnosticReviewRejectedOnly} onChange={e => { setDiagnosticReviewRejectedOnly(e.target.checked); setDiagnosticPage(1); }} /> Rejected imports only (215)</label>
                <label><input type="checkbox" checked={diagnosticReviewMissingNotes} onChange={e => { setDiagnosticReviewMissingNotes(e.target.checked); setDiagnosticPage(1); }} /> Without operator notes (216)</label>
                <label>Review order (217) <select value={diagnosticReviewSort} onChange={e => { setDiagnosticReviewSort(e.target.value as "chronological" | "priority"); setDiagnosticPage(1); }}><option value="chronological">Existing chronological order</option><option value="priority">High priority first, newest within priority</option></select></label>
                <label><input type="checkbox" checked={diagnosticReviewShowSummary} onChange={e => setDiagnosticReviewShowSummary(e.target.checked)} /> Show queue summary (218)</label>
                {diagnosticReviewShowSummary && <p className="muted">Open reviews: {diagnosticReviewOpenCount} (219) | Without notes: {diagnosticReviewUnnotedCount} (220) | Oldest matching import: {diagnosticReviewOldest === null ? "None" : new Date(diagnosticReviewOldest).toLocaleString()} (221)</p>}
                <details className="compact-collapsible"><summary>Review ownership and overdue queue</summary>
                  <label>Review overdue after (224) <select value={diagnosticReviewSlaDays} onChange={e => { setDiagnosticReviewSlaDays(Number(e.target.value)); setDiagnosticPage(1); }}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
                  <label><input type="checkbox" checked={diagnosticReviewOverdueOnly} onChange={e => { setDiagnosticReviewOverdueOnly(e.target.checked); setDiagnosticPage(1); }} /> Overdue open reviews only (225)</label>
                  <label><input type="checkbox" checked={diagnosticReviewUnassignedOnly} onChange={e => { setDiagnosticReviewUnassignedOnly(e.target.checked); setDiagnosticPage(1); }} /> Unassigned reviews only (226)</label>
                  <label>Owner name filter (227) <input type="search" value={diagnosticReviewOwnerFilter} onChange={e => { setDiagnosticReviewOwnerFilter(e.target.value); setDiagnosticPage(1); }} placeholder="Search owner" /></label>
                  <p className="muted">Matching overdue open reviews: {diagnosticReviewOverdueCount} (228) | Unassigned: {diagnosticReviewUnassignedCount} (229). Overdue age is measured from import time.</p>
                  <label>Assign selected to (230) <input type="text" maxLength={80} value={diagnosticReviewBulkOwner} onChange={e => setDiagnosticReviewBulkOwner(e.target.value)} placeholder="Operator name" /></label>
                  <button type="button" disabled={!selectedImportDiagnostics.length || !diagnosticReviewBulkOwner.trim()} onClick={() => updateDiagnosticOwners(selectedImportDiagnostics.map(diagnosticKey), diagnosticReviewBulkOwner)}>Assign selected</button>{" "}
                  <button type="button" disabled={!selectedImportDiagnostics.some(item => diagnosticReviewOwners[diagnosticKey(item)])} onClick={() => { if (window.confirm("Clear owners on selected records?")) updateDiagnosticOwners(selectedImportDiagnostics.map(diagnosticKey), ""); }}>Clear selected owners (231)</button>{" "}
                  <button type="button" onClick={resetDiagnosticOwnershipFilters}>Reset ownership filters (232)</button>{" "}
                  <button type="button" disabled={!diagnosticReviewOverdueCount} onClick={exportDiagnosticOverdueQueue}>Export overdue JSON (233)</button>{" "}
                  <button type="button" onClick={cleanupDiagnosticOwners}>Clean orphaned owners</button>
                  
                  
                  <p className="muted">Ownership is stored only in this browser. It is not synchronized across dashboards.</p>
                </details>
                <button type="button" onClick={resetDiagnosticReviewQueue}>Reset review queue filters (222)</button>{" "}
                <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticReviewSnapshot}>Export review snapshot JSON (223)</button>
              </details>
              <label>Bulk status <select value={diagnosticTriageBulkStatus} onChange={e => setDiagnosticTriageBulkStatus(e.target.value as DiagnosticTriage["status"])}><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
              <button type="button" disabled={!selectedImportDiagnostics.length} onClick={() => updateDiagnosticTriage(selectedImportDiagnostics.map(diagnosticKey), { status: diagnosticTriageBulkStatus })}>Set selected status</button>{" "}
              <label>Bulk priority <select value={diagnosticTriageBulkPriority} onChange={e => setDiagnosticTriageBulkPriority(e.target.value as DiagnosticTriage["priority"])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              <button type="button" disabled={!selectedImportDiagnostics.length} onClick={() => updateDiagnosticTriage(selectedImportDiagnostics.map(diagnosticKey), { priority: diagnosticTriageBulkPriority })}>Set selected priority</button>{" "}
              <button type="button" disabled={!selectedImportDiagnostics.length} onClick={() => { if (window.confirm(`Reset triage labels for ${selectedImportDiagnostics.length} selected records?`)) updateDiagnosticTriage(selectedImportDiagnostics.map(diagnosticKey), { status: "new", priority: "normal" }); }}>Reset selected triage</button>{" "}
              <button type="button" onClick={cleanOrphanedDiagnosticTriage}>Clean orphaned triage</button>{" "}
              <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticTriageRecords}>Export matching triage JSON</button>
            </details>
            <label><input type="checkbox" checked={diagnosticNotesOnly} onChange={e => { setDiagnosticNotesOnly(e.target.checked); setDiagnosticPage(1); }} /> Annotated records only</label>
            <label>Search operator notes <input type="search" value={diagnosticNoteSearch} onChange={e => { setDiagnosticNoteSearch(e.target.value); setDiagnosticPage(1); }} placeholder="Search notes" /></label>
            <label><input type="checkbox" checked={diagnosticIncludeNotesInExports} onChange={e => setDiagnosticIncludeNotesInExports(e.target.checked)} /> Include operator notes in record JSON/Markdown exports</label>
            <p className="muted">Annotated matching records: {diagnosticAnnotatedCount} | Active days: {Object.keys(diagnosticDays).length} | Distinct rejection categories: {Object.keys(diagnosticErrorTypes).length}</p>
            <button type="button" disabled={!diagnosticSelected.some(key => diagnosticNotes[key])} onClick={clearSelectedDiagnosticNotes}>Clear selected notes</button>{" "}
            <button type="button" onClick={pruneOrphanedDiagnosticNotes}>Clean orphaned notes</button>{" "}
            <button type="button" disabled={!diagnosticAnnotatedCount} onClick={exportDiagnosticNotes}>Export notes JSON</button>{" "}
            <button type="button" onClick={exportDiagnosticTriageSummary}>Export triage summary JSON</button>
            <label><input type="checkbox" checked={diagnosticRedactExports} onChange={e => setDiagnosticRedactExports(e.target.checked)} /> Redact filenames in record exports (CSV, JSON, Markdown)</label>
            <p className="muted">Redaction applies to downloaded record files only. The on-screen history and summary grouping remain unchanged.</p>
            {diagnosticBulkNotice && <p role="status" className="muted">{diagnosticBulkNotice}</p>}
            <button type="button" disabled={!visibleImportDiagnostics.length} onClick={invertVisibleDiagnosticSelection}>Invert visible selection</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.some(item => item.outcome === "rejected")} onClick={() => selectDiagnosticSubset("rejected")}>Select matching rejected</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.some(item => diagnosticPinned.includes(diagnosticKey(item)))} onClick={() => selectDiagnosticSubset("pinned")}>Select matching pinned</button>{" "}
            <button type="button" disabled={!diagnosticSelectedPinned} onClick={unpinSelectedDiagnostics}>Unpin selected</button>{" "}
            <button type="button" disabled={!importDiagnostics.some(item => !diagnosticPinned.includes(diagnosticKey(item)))} onClick={removeUnpinnedDiagnostics}>Delete all unpinned</button>{" "}
            <button type="button" disabled={!diagnosticPinned.length} onClick={pruneOrphanedDiagnosticPins}>Clean orphaned pins</button>{" "}
            <button type="button" disabled={!selectedImportDiagnostics.length} onClick={exportSelectedDiagnosticsCsv}>Export selected CSV</button>{" "}
            <button type="button" disabled={!importDiagnostics.some(item => diagnosticPinned.includes(diagnosticKey(item)))} onClick={exportPinnedDiagnostics}>Export pinned JSON</button>

            <button type="button" disabled={!visibleImportDiagnostics.length} onClick={() => setDiagnosticSelected(previous => Array.from(new Set([...previous, ...visibleImportDiagnostics.map(diagnosticKey)])))}>Select visible page</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={() => setDiagnosticSelected(filteredImportDiagnostics.map(diagnosticKey))}>Select all matching</button>{" "}
            <button type="button" disabled={!diagnosticSelected.length} onClick={() => setDiagnosticSelected([])}>Clear selection</button>{" "}
            <button type="button" disabled={!selectedImportDiagnostics.length} onClick={exportSelectedDiagnostics}>Export selected JSON</button>{" "}
            <button type="button" disabled={!selectedImportDiagnostics.length} onClick={deleteSelectedDiagnostics}>Delete selected local records</button>
            <label>Result <select value={diagnosticFilter} onChange={e => setDiagnosticFilter(e.target.value)}><option value="all">All</option><option value="verified">Verified</option><option value="legacy">Legacy unverified</option><option value="rejected">Rejected</option></select></label>
            <label>Search diagnostics <input type="search" value={diagnosticSearch} onChange={e => { setDiagnosticSearch(e.target.value); setDiagnosticPage(1); }} placeholder="Filename, validation check or error" /></label>
            <label>Filename contains <input type="search" value={diagnosticFileFilter} onChange={e => { setDiagnosticFileFilter(e.target.value); setDiagnosticPage(1); }} placeholder="Filter by filename" /></label>
            <label>Validation checkpoint contains <input type="search" value={diagnosticCheckFilter} onChange={e => { setDiagnosticCheckFilter(e.target.value); setDiagnosticPage(1); }} placeholder="Filter by passed check" /></label>
            <label>From <input type="date" value={diagnosticFrom} onChange={e => setDiagnosticFrom(e.target.value)} /></label>
            <label>To <input type="date" value={diagnosticTo} onChange={e => setDiagnosticTo(e.target.value)} /></label>
            <label>Minimum file size (bytes) <input type="number" min="0" step="1" value={diagnosticMinBytes} onChange={e => { setDiagnosticMinBytes(e.target.value); setDiagnosticPage(1); }} /></label>
            <label>Maximum file size (bytes) <input type="number" min="0" step="1" value={diagnosticMaxBytes} onChange={e => { setDiagnosticMaxBytes(e.target.value); setDiagnosticPage(1); }} /></label>
            <label><input type="checkbox" checked={diagnosticErrorsOnly} onChange={e => { setDiagnosticErrorsOnly(e.target.checked); setDiagnosticPage(1); }} /> Errors only</label>
            <label>Order <select value={diagnosticSort} onChange={e => setDiagnosticSort(e.target.value as "newest" | "oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            <p className="muted">Matching {filteredImportDiagnostics.length} of {importDiagnostics.length} retained attempts | Verified: {diagnosticCounts.verified} | Legacy: {diagnosticCounts.legacy} | Rejected: {diagnosticCounts.rejected}</p>
            <p className="muted">Import acceptance rate: {diagnosticSuccessPercent === null ? "No matching attempts" : `${diagnosticSuccessPercent}%`} (verified or legacy accepted). This is a backup-import metric, not camera reliability.</p>
            <p className="muted">Unique filenames: {diagnosticUniqueFiles} | Average file size: {diagnosticAverageBytes === null ? "N/A" : `${diagnosticAverageBytes} bytes`} | Passed checkpoints: {diagnosticTotalChecks}</p>
            <p className="muted">Most recent retained attempt: {diagnosticLatestAttempt ? `${new Date(diagnosticLatestAttempt.at).toLocaleString()} (${diagnosticLatestAttempt.outcome})` : "None"}</p>
            <label><input type="checkbox" checked={diagnosticShowChecks} onChange={e => setDiagnosticShowChecks(e.target.checked)} /> Show validation checkpoints</label>
            <label><input type="checkbox" checked={diagnosticShowErrors} onChange={e => setDiagnosticShowErrors(e.target.checked)} /> Show error details</label>
            <label>Records per page <select value={diagnosticPageSize} onChange={e => { setDiagnosticPageSize(Number(e.target.value)); setDiagnosticPage(1); }}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
            <span className="muted"> Showing {diagnosticVisibleStart}-{diagnosticVisibleEnd} of {filteredImportDiagnostics.length} | Page {safeDiagnosticPage} of {diagnosticPageCount} </span>
            <button type="button" disabled={safeDiagnosticPage <= 1} onClick={() => setDiagnosticPage(1)}>First page</button>{" "}
            <button type="button" disabled={safeDiagnosticPage <= 1} onClick={() => setDiagnosticPage(p => Math.max(1, p - 1))}>Previous page</button>{" "}
            <button type="button" disabled={safeDiagnosticPage >= diagnosticPageCount} onClick={() => setDiagnosticPage(p => Math.min(diagnosticPageCount, p + 1))}>Next page</button>{" "}
            <button type="button" disabled={safeDiagnosticPage >= diagnosticPageCount} onClick={() => setDiagnosticPage(diagnosticPageCount)}>Last page</button>
            <label>Go to page <input type="number" min="1" max={diagnosticPageCount} value={diagnosticJumpPage} onChange={e => setDiagnosticJumpPage(e.target.value)} style={{ width: 70 }} /></label>
            <button type="button" onClick={() => { const page = Number(diagnosticJumpPage); if (Number.isInteger(page) && page >= 1 && page <= diagnosticPageCount) setDiagnosticPage(page); }}>Go</button>{" "}
            <button type="button" onClick={() => { setDiagnosticFilter("all"); setDiagnosticSearch(""); setDiagnosticFrom(""); setDiagnosticTo(""); setDiagnosticSort("newest"); setDiagnosticMinBytes(""); setDiagnosticMaxBytes(""); setDiagnosticErrorsOnly(false); setDiagnosticFileFilter(""); setDiagnosticCheckFilter(""); setDiagnosticShowChecks(true); setDiagnosticShowErrors(true); setDiagnosticPinnedOnly(false); setDiagnosticNotesOnly(false); setDiagnosticNoteSearch(""); setDiagnosticGroupBy("none"); setDiagnosticTriageStatusFilter("all"); setDiagnosticTriagePriorityFilter("all"); setDiagnosticTriageOnlyOpen(false); setDiagnosticTriageOnlyHigh(false); setDiagnosticPage(1); setDiagnosticJumpPage("1"); }}>Reset filters</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportImportDiagnostics}>Export diagnostics CSV</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportImportDiagnosticsJson}>Export diagnostics JSON</button>{" "}
            <button type="button" onClick={exportDiagnosticSummary}>Export summary JSON</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticMarkdown}>Export report Markdown</button>{" "}
            <button type="button" disabled={!importDiagnostics.length} onClick={() => { if (window.confirm("Clear this browser's threshold import diagnostic history?")) { setImportDiagnostics([]); setDiagnosticSelected([]); setDiagnosticPinned([]); localStorage.removeItem("tournament-threshold-import-diagnostics-v1"); localStorage.removeItem("tournament-threshold-import-pins-v1"); setDiagnosticNotes({}); localStorage.removeItem("tournament-threshold-import-notes-v1"); setDiagnosticTriage({}); localStorage.removeItem("tournament-threshold-import-triage-v1"); setDiagnosticReviewOwners({}); localStorage.removeItem("tournament-threshold-import-owners-v1"); } }}>Clear local history</button>
            {diagnosticCopyNotice && <p role="status" className="muted">{diagnosticCopyNotice}</p>}
            {visibleImportDiagnostics.map((item, index) => <details key={`${item.at}-${index}`} className="compact-collapsible"><summary>{new Date(item.at).toLocaleString()} | {item.outcome} | {item.fileName}</summary>
              <p>File size: {item.bytes} bytes</p>
              <label>Triage status <select value={triageFor(diagnosticKey(item)).status} onChange={e => updateDiagnosticTriage([diagnosticKey(item)], { status: e.target.value as DiagnosticTriage["status"] })}><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
              <label>Priority <select value={triageFor(diagnosticKey(item)).priority} onChange={e => updateDiagnosticTriage([diagnosticKey(item)], { priority: e.target.value as DiagnosticTriage["priority"] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              <label>Operator note (browser-local, 500 characters max) <textarea rows={2} maxLength={500} value={diagnosticNotes[diagnosticKey(item)] || ""} onChange={e => saveDiagnosticNote(diagnosticKey(item), e.target.value)} placeholder="Add investigation details" /></label>
              <button type="button" disabled={!diagnosticNotes[diagnosticKey(item)]} onClick={() => saveDiagnosticNote(diagnosticKey(item), "")}>Clear note</button>
              {diagnosticShowChecks && item.checks.map((check, i) => <p key={i}>Passed: {check}</p>)}
              {diagnosticShowErrors && item.error && <p role="alert">Rejected: {item.error}</p>}
              <label><input type="checkbox" checked={diagnosticSelected.includes(diagnosticKey(item))} onChange={e => setDiagnosticSelected(previous => e.target.checked ? Array.from(new Set([...previous, diagnosticKey(item)])) : previous.filter(key => key !== diagnosticKey(item)))} /> Select record</label>{" "}
              <button type="button" onClick={() => toggleDiagnosticPin(diagnosticKey(item))}>{diagnosticPinned.includes(diagnosticKey(item)) ? "Unpin record" : "Pin record"}</button>{" "}
              <button type="button" onClick={() => void copySingleDiagnostic(item)}>Copy details</button>{" "}
              <button type="button" onClick={() => exportSingleDiagnostic(item)}>Export this record JSON</button>
            </details>)}
          </details>
          {importedRules && <div className="bulk-results"><p><strong>Validated backup:</strong> {importFileName}</p>
            {importIntegrityStatus && <p className="muted">{importIntegrityStatus}</p>}
            <p className="muted">Compare the imported values against the current editor. Select only the fields to restore. Unselected values remain unchanged.</p>
            <button type="button" onClick={() => setSelectedImportFields(Object.keys(importedRules) as Array<keyof ReliabilityRules>)}>Select all</button>{" "}
            <button type="button" onClick={() => setSelectedImportFields([])}>Select none</button>
            {(Object.keys(importedRules) as Array<keyof ReliabilityRules>).map(key => <label key={key} style={{ display: "block" }}>
              <input type="checkbox" checked={selectedImportFields.includes(key)} onChange={e => setSelectedImportFields(previous => e.target.checked ? [...previous, key] : previous.filter(field => field !== key))} />{" "}
              <strong>{key}</strong>: current {reliabilityRules[key]} → backup {importedRules[key]} {reliabilityRules[key] === importedRules[key] ? "(unchanged)" : "(different)"}
            </label>)}
            {importMergeError && <p role="alert">Selected fields produce invalid thresholds: {importMergeError}. Adjust your selection before applying.</p>}
            {mergedImportRules && !importMergeError && <p className="muted">Merged preview: {Object.entries(mergedImportRules).map(([key, value]) => `${key}=${value}`).join(", ")}</p>}
            <button type="button" disabled={!selectedImportFields.length || !!importMergeError || rulesSaving || rulesConflict || !rulesReady} onClick={applyReliabilityImport}>Apply selected values to editor</button>
            <button type="button" onClick={() => { setImportedRules(null); setImportFileName(""); setSelectedImportFields([]); }}>Cancel import</button>
          </div>}
        </details>
        <details className="compact-collapsible"><summary>Shared threshold change history ({ruleHistory.length})</summary>
          <p className="muted">Last 500 recorded changes, newest first. Timestamps use your local timezone. Changes are shared across connected dashboards.</p>
          {ruleHistory.length === 0 ? <p>No threshold changes recorded.</p> : ruleHistory.slice(0, 50).map(change => <div key={change.id} className="bulk-results">
            <p><strong>{new Date(change.at).toLocaleString()}</strong> {change.note ? `| ${change.note}` : "| No reason supplied"}</p>
            <button type="button" disabled={rulesSaving || rulesConflict || rulesVersion === null} onClick={() => void restoreHistoricalRules(change.id, "before")}>Restore previous values</button>
            <button type="button" disabled={rulesSaving || rulesConflict || rulesVersion === null} onClick={() => void restoreHistoricalRules(change.id, "after")}>Restore updated values</button>
            {(Object.keys(change.after) as Array<keyof ReliabilityRules>).filter(key => change.before[key] !== change.after[key]).map(key => <p key={key}>{key}: {change.before[key]} → {change.after[key]}</p>)}
          </div>)}
        </details>
        {reliabilityWarnings.length === 0 ? <p>No cameras currently cross the configured reliability thresholds.</p> :
          <div className="bulk-results">{reliabilityWarnings.map(warning => <p key={warning.cameraId} role="status">
            <strong>{warning.severity}: {warning.cameraId}</strong> | {warning.failures} failures / {warning.attempts} attempts | {warning.rate}% successful
          </p>)}</div>}
      </details>
      <details className="compact-collapsible"><summary>Reliability warning history ({reliabilityHistory.length})</summary>
        <p className="muted">Shared server history of changes between Normal, Warning, and Critical. A new audit attempt or a threshold/reporting-period change can produce a transition. No changes are recorded on an unchanged polling refresh. Transitions and acknowledgements synchronize through the node service.</p>
        <label>Transition to <select value={historyFilter} onChange={e => setHistoryFilter(e.target.value)}>
          <option value="all">All states</option><option value="Warning">Warning</option><option value="Critical">Critical</option><option value="Normal">Normal</option>
        </select></label>
        <label>Operator review <select value={historyReviewFilter} onChange={e => setHistoryReviewFilter(e.target.value)}>
          <option value="all">All</option><option value="unreviewed">Unacknowledged</option><option value="reviewed">Acknowledged</option>
        </select></label>
        <button type="button" disabled={!visibleReliabilityHistory.length} onClick={exportReliabilityHistory}>Export warning history CSV</button>
        {visibleReliabilityHistory.length === 0 ? <p>No recorded warning transitions.</p> :
          <div className="bulk-results">{visibleReliabilityHistory.slice(0, 50).map((item, index) => <p key={`${item.at}-${item.cameraId}-${index}`}>
            <strong>{item.cameraId}: {item.from} → {item.to}</strong> | {new Date(item.at).toLocaleString()} | {item.reason}
            {reliabilityReviews[reliabilityReviewKey(item)] ?
              <span> | Acknowledged {new Date(reliabilityReviews[reliabilityReviewKey(item)].acknowledgedAt).toLocaleString()} | Note: {reliabilityReviews[reliabilityReviewKey(item)].note}</span> :
              <span> | Unacknowledged <label>Operator note <input type="text" maxLength={1000} value={reviewNotes[reliabilityReviewKey(item)] || ""} onChange={e => setReviewNotes(previous => ({ ...previous, [reliabilityReviewKey(item)]: e.target.value }))} /></label>
                <button type="button" disabled={!((reviewNotes[reliabilityReviewKey(item)] || "").trim())} onClick={() => acknowledgeReliabilityWarning(item)}>Acknowledge</button></span>}
          </p>)}</div>}
        {visibleReliabilityHistory.length > 50 && <p className="muted">Showing 50 of {visibleReliabilityHistory.length} matching transitions. CSV includes all matches.</p>}
      </details>
      <details className="compact-collapsible"><summary>Camera reliability breakdown ({recoveryStatistics.cameras.length})</summary>
        {recoveryStatistics.cameras.length === 0 ? <p>No recovery attempts in this period.</p> :
          <div className="bulk-results">{recoveryStatistics.cameras.map(camera => <p key={camera.cameraId}>
            <strong>{camera.cameraId}</strong>: {camera.successes} successful, {camera.failures} failed ({Math.round(camera.successes * 100 / (camera.successes + camera.failures))}% success)
          </p>)}</div>}
      </details>
      <details className="compact-collapsible"><summary>Daily recovery trend ({recoveryStatistics.daily.length} days with attempts)</summary>
        {recoveryStatistics.daily.length === 0 ? <p>No recovery attempts in this period.</p> :
          <div className="bulk-results">{recoveryStatistics.daily.map(day => <p key={day.day}>
            <strong>{day.day}</strong>: {day.successes} successful, {day.failures} failed
          </p>)}</div>}
      </details>
    </details>
    <details className="compact-collapsible"><summary>Incident timeline and operator audit ({audit.length})</summary>
      <p className="muted">Search and filter the latest 2,000 retained audit events. Export downloads the filtered records as CSV. Filters do not alter the stored audit.</p>
      <div className="bulk-results">
        <label>Search camera, event or details <input type="search" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search audit" /></label>
        <label>Event type <select value={auditType} onChange={e => setAuditType(e.target.value)}>
          <option value="all">All types</option><option value="failure">Failure</option><option value="success">Success</option>
          <option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="reopened">Reopened</option>
        </select></label>
        <label>From <input type="date" value={auditFrom} onChange={e => setAuditFrom(e.target.value)} /></label>
        <label>Through <input type="date" value={auditTo} onChange={e => setAuditTo(e.target.value)} /></label>
        <p>{filteredAudit.length} matching events of {audit.length} retained.</p>
        <button type="button" onClick={() => { setAuditSearch(""); setAuditType("all"); setAuditFrom(""); setAuditTo(""); }}>Clear filters</button>
        <button type="button" disabled={filteredAudit.length === 0} onClick={exportAuditCsv}>Export filtered CSV ({filteredAudit.length})</button>
      </div>
      {filteredAudit.length === 0 ? <p>No matching audit events.</p> :
        <div className="bulk-results">{filteredAudit.slice(0, 100).map((entry, index) => <p key={`${entry.at}-${entry.cameraId}-${entry.type}-${index}`}>
          <strong>{entry.type}</strong> | {new Date(entry.at).toLocaleString()} | {entry.cameraId}: {entry.detail}
        </p>)}</div>}
      {filteredAudit.length > 100 && <p className="muted">Showing first 100 matching events. CSV export includes all {filteredAudit.length} matches.</p>}
    </details>
    <details className="compact-collapsible"><summary>Recovery history ({events.length})</summary>
      {events.length === 0 ? <p>No recovery attempts recorded.</p> :
        <div className="bulk-results">{events.map((event, i) => <p key={`${event.at}-${event.cameraId}-${i}`}>
          <strong>{event.outcome === "success" ? "Recovered" : "Failed"}</strong> | {new Date(event.at).toLocaleString()} | {event.cameraId}: {event.detail} {event.acknowledgedAt ? "| Acknowledged" : event.outcome === "failure" ? "| Needs review" : ""}
        </p>)}</div>}
    </details>
  </section>;
}
