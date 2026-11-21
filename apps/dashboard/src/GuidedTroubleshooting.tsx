import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GuidedTestStatus = "not-run" | "pass" | "fail" | "inconclusive";

export type GuidedTestEntry = { status: GuidedTestStatus; notes: string; updatedAt: string | null };

export type GuidedTestId = "baseline" | "usb" | "encoder" | "storage" | "verification";

export const guidedTestSteps: Array<{ id: GuidedTestId; title: string; instructions: string[] }> = [
  { id: "baseline", title: "Baseline: reproduce the issue", instructions: [
    "Record which cameras are connected, their USB ports, capture settings, and recording destination.",
    "With a safe test event, record all intended cameras for at least 30 seconds and export the stress-test JSON.",
    "Note any failures and timestamps before changing one variable at a time."
  ] },
  { id: "usb", title: "USB isolation", instructions: [
    "Stop the affected camera recording before moving its USB cable. Do not unplug a live recording.",
    "Try the same camera and settings on a different verified USB host controller, then repeat the test.",
    "If the problem follows the camera, test a known-good cable; if it follows the port, investigate the port/controller."
  ] },
  { id: "encoder", title: "Capture and encoding isolation", instructions: [
    "Save the original settings and ensure no tournament stream depends on the camera before making changes.",
    "Repeat a test at 1080p30 instead of 1080p60, if supported, while keeping the same USB port and storage path.",
    "Compare FFmpeg logs, dropped/stale preview indicators, CPU and GPU samples; revert settings afterward."
  ] },
  { id: "storage", title: "Storage isolation", instructions: [
    "Verify free space, recording destination health, and whether other processes are saturating the drive.",
    "During a test event, compare recording to a different healthy local drive if one is available.",
    "Do not move or delete original tournament recordings as part of the test."
  ] },
  { id: "verification", title: "Verify and document", instructions: [
    "Restore intended camera settings and USB connections, then repeat a full multi-camera stress test.",
    "Verify recorded file playback, audio, and YouTube relay status separately.",
    "Record findings and any remaining uncertainty in the incident log; export this worksheet."
  ] }
];

export const guidedTestEmpty = (): Record<GuidedTestId, GuidedTestEntry> => ({
  baseline: { status: "not-run", notes: "", updatedAt: null },
  usb: { status: "not-run", notes: "", updatedAt: null },
  encoder: { status: "not-run", notes: "", updatedAt: null },
  storage: { status: "not-run", notes: "", updatedAt: null },
  verification: { status: "not-run", notes: "", updatedAt: null }
});

export type SavedGuidedTest = { id: string; savedAt: string; cameraId: string; operator: string;
  steps: Record<GuidedTestId, GuidedTestEntry>; summary: string; changeMade: string };

export const GUIDED_HISTORY_KEY = "tournament-guided-troubleshooting-v1";

export function readGuidedHistory(): SavedGuidedTest[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GUIDED_HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedGuidedTest => Boolean(item && typeof item === "object" &&
      typeof item.id === "string" && typeof item.savedAt === "string" &&
      typeof item.cameraId === "string" && item.steps && typeof item.steps === "object"))
      .slice(0, 30);
  } catch { return []; }
}

export type TroubleshootingEffectivenessRow = { category: string; comparisons: number; improved: number; unchanged: number; regressed: number; inconclusive: number };

export function classifyTroubleshootingChange(value: string): string {
  const change = value.toLowerCase();
  if (/usb|controller|port|cable|hub/.test(change)) return "USB connection / controller";
  if (/encod|nvenc|fps|frame.?rate|bitrate|resolution|gpu/.test(change)) return "Encoding / capture settings";
  if (/disk|drive|storage|ssd|write|recording path/.test(change)) return "Storage";
  if (/cpu|memory|ram|process|load/.test(change)) return "System resources";
  return "Other / unspecified";
}

export function summarizeTroubleshootingEffectiveness(history: SavedGuidedTest[]) {
  // Compare adjacent chronological worksheets for each camera, never across cameras.
  // A change is attributed to the later worksheet, not inferred from the earlier one.
  const byCamera = new Map<string, SavedGuidedTest[]>();
  for (const item of history) {
    const key = item.cameraId.trim().toLowerCase();
    if (!key) continue;
    byCamera.set(key, [...(byCamera.get(key) || []), item]);
  }
  const totals = new Map<string, TroubleshootingEffectivenessRow>();
  const pairs: Array<{ camera: string; before: SavedGuidedTest; after: SavedGuidedTest; result: string; category: string }> = [];
  for (const entries of byCamera.values()) {
    entries.sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt));
    for (let i = 1; i < entries.length; i++) {
      const before = entries[i - 1]; const after = entries[i];
      const oldStatus = before.steps?.verification?.status;
      const newStatus = after.steps?.verification?.status;
      const category = classifyTroubleshootingChange(after.changeMade || "");
      let result = "inconclusive";
      if ((oldStatus === "pass" || oldStatus === "fail") &&
          (newStatus === "pass" || newStatus === "fail")) {
        result = oldStatus === "fail" && newStatus === "pass" ? "improved" :
          oldStatus === "pass" && newStatus === "fail" ? "regressed" : "unchanged";
      }
      const row = totals.get(category) || { category, comparisons: 0, improved: 0,
        unchanged: 0, regressed: 0, inconclusive: 0 };
      row.comparisons++;
      if (result === "improved") row.improved++;
      else if (result === "regressed") row.regressed++;
      else if (result === "unchanged") row.unchanged++;
      else row.inconclusive++;
      totals.set(category, row);
      pairs.push({ camera: after.cameraId, before, after, result, category });
    }
  }
  return { rows: [...totals.values()].sort((a, b) => b.comparisons - a.comparisons), pairs };
}

export function TroubleshootingEffectiveness({ history }: { history: SavedGuidedTest[] }) {
  const { rows, pairs } = useMemo(() => summarizeTroubleshootingEffectiveness(history), [history]);
  function exportSummary() {
    const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(),
      method: "Consecutive saved worksheets for the same camera, compared by operator-reported final verification status",
      categories: rows, comparisons: pairs.map(pair => ({ camera: pair.camera,
        beforeId: pair.before.id, beforeAt: pair.before.savedAt,
        afterId: pair.after.id, afterAt: pair.after.savedAt,
        changeMade: pair.after.changeMade, category: pair.category, result: pair.result })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "troubleshooting-effectiveness.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div>
    <h4>Troubleshooting effectiveness statistics</h4>
    <p>Compares consecutive saved worksheets for the same camera. The later worksheet's
      change description determines the category. Only the manually reported final verification
      result is used to classify improvements or regressions.</p>
    {rows.length ? <><div style={{ overflowX: "auto" }}><table><thead><tr>
      <th>Change category</th><th>Comparisons</th><th>Improved</th><th>Unchanged</th>
      <th>Regressed</th><th>Inconclusive</th>
    </tr></thead><tbody>{rows.map(row => <tr key={row.category}>
      <td>{row.category}</td><td>{row.comparisons}</td><td>{row.improved}</td>
      <td>{row.unchanged}</td><td>{row.regressed}</td><td>{row.inconclusive}</td>
    </tr>)}</tbody></table></div>
    <button type="button" onClick={exportSummary}>Export effectiveness statistics JSON</button>
    <details><summary>Show individual comparisons ({pairs.length})</summary>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Camera</th><th>Before</th><th>After</th><th>Change</th><th>Result</th>
      </tr></thead><tbody>{pairs.map(pair => <tr key={`${pair.before.id}:${pair.after.id}`}>
        <td>{pair.camera}</td><td>{new Date(pair.before.savedAt).toLocaleString()}</td>
        <td>{new Date(pair.after.savedAt).toLocaleString()}</td>
        <td>{pair.after.changeMade || "Unspecified"}</td><td>{pair.result}</td>
      </tr>)}</tbody></table></div>
    </details></> : <p>Save at least two worksheets for the same camera to see comparisons.</p>}
    <p className="muted">These are operator-reported associations, not measured failure rates or
      proof that a change caused an improvement. Unrecorded intermediate changes, different
      test conditions, and the 30-worksheet retention limit can affect these counts.</p>
  </div>;
}

export function GuidedTroubleshootingTests() {
  const [cameraId, setCameraId] = useState("");
  const [operator, setOperator] = useState("");
  const [entries, setEntries] = useState(guidedTestEmpty);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<SavedGuidedTest[]>(readGuidedHistory);
  const [summary, setSummary] = useState("");
  const [changeMade, setChangeMade] = useState("");
  const [comparisonIds, setComparisonIds] = useState<[string, string]>(["", ""]);
  function persistHistory(next: SavedGuidedTest[]) {
    try { localStorage.setItem(GUIDED_HISTORY_KEY, JSON.stringify(next.slice(0, 30)));
      setHistory(next.slice(0, 30)); setNotice("Troubleshooting history saved in this browser."); }
    catch { setNotice("Browser storage unavailable. Export the history JSON instead."); }
  }
  function saveWorksheet() {
    if (!cameraId.trim()) { setNotice("Enter a camera / ring identifier before saving."); return; }
    const saved: SavedGuidedTest = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      savedAt: new Date().toISOString(), cameraId: cameraId.trim(), operator: operator.trim(),
      steps: JSON.parse(JSON.stringify(entries)) as Record<GuidedTestId, GuidedTestEntry>,
      summary: summary.trim(), changeMade: changeMade.trim() };
    persistHistory([saved, ...history]);
  }
  function downloadHistory() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1,
      exportedAt: new Date().toISOString(), worksheets: history }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "guided-troubleshooting-history.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importHistory(files: FileList | null) {
    const file = files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { setNotice("History file exceeds 2 MB."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const input = parsed as { worksheets?: unknown };
      if (!input || !Array.isArray(input.worksheets)) throw new Error("Expected a worksheets array.");
      const valid = input.worksheets.filter((item: any) => item && typeof item.id === "string" &&
        typeof item.savedAt === "string" && !Number.isNaN(Date.parse(item.savedAt)) &&
        typeof item.cameraId === "string" && item.cameraId.length <= 120 &&
        typeof item.operator === "string" && item.operator.length <= 120 &&
        typeof item.summary === "string" && item.summary.length <= 3000 &&
        typeof item.changeMade === "string" && item.changeMade.length <= 1000 &&
        item.steps && guidedTestSteps.every(step => item.steps[step.id] &&
          ["not-run", "pass", "fail", "inconclusive"].includes(item.steps[step.id].status) &&
          typeof item.steps[step.id].notes === "string" && item.steps[step.id].notes.length <= 3000));
      if (!valid.length) throw new Error("No valid worksheets in the file.");
      const merged = [...valid, ...history].filter((item, index, all) =>
        all.findIndex(other => other.id === item.id) === index)
        .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).slice(0, 30);
      persistHistory(merged);
    } catch (error) { setNotice(`Import failed: ${String(error)}`); }
  }
  const compare = comparisonIds.map(id => history.find(item => item.id === id));
  function update(id: GuidedTestId, patch: Partial<GuidedTestEntry>) {
    setEntries(current => ({ ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } }));
  }
  function exportWorksheet() {
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), cameraId: cameraId.trim(),
      operator: operator.trim(), steps: guidedTestSteps.map(step => ({ ...step, ...entries[step.id] })),
      disclaimer: "Operator-entered results only. No test was automatically run by this worksheet." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `guided-camera-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Worksheet exported. Save it with the matching stress-test and FFmpeg reports.");
  }
  return <section className="session-panel" aria-label="Guided camera troubleshooting tests">
    <h3>Guided camera troubleshooting tests</h3>
    <p>Operator-led isolation checklist. No camera, recording, YouTube stream, or system setting is
      changed by these controls. Run tests only when equipment is not needed for a live event.</p>
    <label>Camera / ring identifier <input value={cameraId} maxLength={120}
      onChange={e => setCameraId(e.target.value)} placeholder="e.g. Ring 3" /></label>{" "}
    <label>Operator <input value={operator} maxLength={120}
      onChange={e => setOperator(e.target.value)} placeholder="Optional" /></label>
    {guidedTestSteps.map(step => <fieldset key={step.id}>
      <legend>{step.title}</legend>
      <ol>{step.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol>
      <label>Result{" "}<select value={entries[step.id].status}
        onChange={e => update(step.id, { status: e.target.value as GuidedTestStatus })}>
        <option value="not-run">Not run</option><option value="pass">Passed (operator verified)</option>
        <option value="fail">Failed (operator verified)</option>
        <option value="inconclusive">Inconclusive</option>
      </select></label>{" "}
      <label>Observations / report filename{" "}<textarea rows={2} maxLength={3000}
        value={entries[step.id].notes} onChange={e => update(step.id, { notes: e.target.value })}
        placeholder="Evidence, timestamps, cable/port, settings, result..." /></label>
    </fieldset>)}
    <p>{guidedTestSteps.filter(step => entries[step.id].status !== "not-run").length} of
      {" "}{guidedTestSteps.length} steps assessed. Results are manual, not verified by the application.</p>
    <label>Change tested / fix applied <input maxLength={1000} value={changeMade}
      onChange={e => setChangeMade(e.target.value)} placeholder="e.g. moved camera to PCIe USB controller" /></label>{" "}
    <label>Outcome summary <textarea maxLength={3000} rows={2} value={summary}
      onChange={e => setSummary(e.target.value)} placeholder="What improved, what remains unresolved?" /></label>
    <button type="button" onClick={saveWorksheet}>Save worksheet to browser history</button>{" "}
    <button type="button" onClick={exportWorksheet}>Export guided test worksheet JSON</button>{" "}
    <button type="button" onClick={() => {
      if (window.confirm("Clear this unsaved troubleshooting worksheet?")) {
        setEntries(guidedTestEmpty()); setCameraId(""); setOperator(""); setSummary(""); setChangeMade(""); setNotice("");
      }
    }}>Clear worksheet</button>
    {notice && <p role="status">{notice}</p>}
    <h4>Saved troubleshooting history</h4>
    <p>Up to 30 worksheets are retained in this browser. Compare two tests for the same camera
      to assess operator-reported changes. This does not measure reliability automatically.</p>
    <button type="button" disabled={!history.length} onClick={downloadHistory}>Export history JSON</button>{" "}
    <label>Import history JSON <input type="file" accept=".json,application/json"
      onChange={e => { void importHistory(e.target.files); e.target.value = ""; }} /></label>
    {history.length ? <div style={{ overflowX: "auto" }}><table><thead><tr>
      <th>Saved</th><th>Camera</th><th>Change tested</th><th>Outcome</th><th>Actions</th>
    </tr></thead><tbody>{history.map(item => <tr key={item.id}>
      <td>{new Date(item.savedAt).toLocaleString()}</td><td>{item.cameraId}</td>
      <td>{item.changeMade || "Not specified"}</td><td>{item.summary || "Not specified"}</td>
      <td><button type="button" onClick={() => { setCameraId(item.cameraId); setOperator(item.operator);
        setEntries(JSON.parse(JSON.stringify(item.steps))); setSummary(item.summary); setChangeMade(item.changeMade);
        setNotice("Worksheet loaded. Save as a new entry after making changes."); }}>Load</button>{" "}
        <button type="button" onClick={() => { if (window.confirm("Delete this saved worksheet?"))
          persistHistory(history.filter(entry => entry.id !== item.id)); }}>Delete</button></td>
    </tr>)}</tbody></table></div> : <p>No saved worksheets yet.</p>}
    <TroubleshootingEffectiveness history={history} />
    {([0, 1] as const).map(index => <label key={index}>Comparison {index === 0 ? "before" : "after"}{" "}
      <select value={comparisonIds[index]} onChange={e => setComparisonIds(current =>
        index === 0 ? [e.target.value, current[1]] : [current[0], e.target.value])}>
        <option value="">Choose worksheet</option>{history.map(item => <option key={item.id} value={item.id}>
          {item.cameraId} / {new Date(item.savedAt).toLocaleString()}</option>)}</select></label>)}
    {compare[0] && compare[1] && <div>
      {compare[0].cameraId !== compare[1].cameraId && <p role="alert">Different cameras selected.
        Results may not be directly comparable.</p>}
      <table><thead><tr><th>Test</th><th>Before</th><th>After</th></tr></thead><tbody>
        {guidedTestSteps.map(step => <tr key={step.id}><td>{step.title}</td>
          <td>{compare[0]!.steps[step.id]?.status || "Missing"}</td>
          <td>{compare[1]!.steps[step.id]?.status || "Missing"}</td></tr>)}
      </tbody></table>
      <p><strong>Before:</strong> {compare[0].summary || "No summary"}</p>
      <p><strong>After:</strong> {compare[1].summary || "No summary"}</p>
      <p>Pass/fail results are manually reported. A change from fail to pass is not proof of a
        permanent fix. Repeat comparable multi-camera stress tests to verify reliability.</p>
    </div>}
    <p className="muted">History is local to this browser and does not synchronize between operator PCs.
      Export regularly for backup. No tests are run or camera settings changed automatically.</p>
  </section>;
}
