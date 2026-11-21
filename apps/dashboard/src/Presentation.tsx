import { useTournamentSlides, ScheduleSlides, ScheduleEditor, RotationEditor } from "./TournamentSlides";
import { CameraRotation, readDisplayConfig } from "./TournamentDisplayExtras";
import { useEffect, useState } from "react";
import { startPolling } from "./operator-polling";
import { operatorApi } from "./operator-api";
import "./Presentation.css";

type Assignment = { ring: string; cameraName: string; cameraId: string };
type Session = { eventName: string; assignments: Assignment[] };
export default function Presentation() {
  const { doc, save, message } = useTournamentSlides();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("Connecting...");
  // Old billboard and schedule links both lead to the consolidated billboard.
  const [mode, setMode] = useState<"schedule" | "cameras">(() => new URLSearchParams(location.search).get("mode") === "cameras" ? "cameras" : "schedule");
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showClock, setShowClock] = useState(true);
  const [extraConfig] = useState(readDisplayConfig);
  const [auth, setAuth] = useState<"checking" | "locked" | "unlocked">("checking");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  useEffect(() => { let alive = true; const stop = startPolling(async () => {
    try { const data = await operatorApi.request("/api/session", { cache: "no-store" }); if (alive) { setSession(data.session ?? null); setStatus("Connected"); } }
    catch { if (alive) setStatus("Disconnected"); }
  }, 5000); return () => { alive = false; stop(); }; }, []);
  useEffect(() => { let alive = true; void operatorApi.request("/api/auth/status").then(data => { if (alive) setAuth(data.configured && !data.unlocked ? "locked" : "unlocked"); }).catch(() => { if (alive) setAuth("locked"); }); return () => { alive = false; }; }, []);
  useEffect(() => { const change = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener("fullscreenchange", change); return () => document.removeEventListener("fullscreenchange", change); }, []);
  async function unlock() {
    try { const data = await operatorApi.request("/api/auth/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); operatorApi.setToken(data.token); setAuth("unlocked"); setPassword(""); setAuthError(""); }
    catch (error) { setAuthError(String(error)); }
  }
  function choose(next: "schedule" | "cameras", edit = false) { setMode(next); setEditing(edit); history.replaceState(null, "", `/presentation?mode=${next}`); }
  const assignments = (session?.assignments ?? []).filter(a => a.cameraId);
  return <div className={`presentation-root presentation-mode-${mode} ${editing ? "presentation-editing" : ""} ${fullscreen ? "presentation-fullscreen" : ""}`}>
    {!fullscreen && <nav className="presentation-toolbar" aria-label="Presentation controls">
      <a href="/">Dashboard</a>
      <button onClick={() => choose("schedule")}>Billboard</button>
      <button onClick={() => choose("cameras")}>Camera display</button>
      <button onClick={() => choose(mode, !editing)}>{editing ? "Close editor" : mode === "schedule" ? "Edit billboard" : "Camera settings"}</button>
      <button onClick={() => void document.documentElement.requestFullscreen()}>Fullscreen</button>
      {mode === "schedule" && <label><input type="checkbox" checked={showClock} onChange={e => setShowClock(e.target.checked)}/> Clock</label>}
      <span className="presentation-connection">{status} | {message}</span>
    </nav>}
    <div className={`presentation-content presentation-layout-classic ${mode === "cameras" && editing && !fullscreen ? "presentation-camera-editor-preview" : ""}`}>
      {mode === "cameras" ? (!doc.rotation.enabled ? <p className="presentation-empty">Camera rotation is off. Enable it under Camera settings.</p> : <CameraRotation cameras={assignments.filter(a => !doc.rotation.blacklist.includes(a.cameraId))} config={{ ...extraConfig, ...doc.rotation }} fullscreen={fullscreen}/>) : <ScheduleSlides slides={doc.slides} branding={doc.branding} showClock={showClock}/>}
    </div>
    {editing && !fullscreen && (auth === "unlocked" ? (mode === "schedule" ? <ScheduleEditor doc={doc} save={save} message={message}/> : <RotationEditor doc={doc} save={save} cameras={assignments}/>) : <section className="presentation-editor"><h2>Unlock display editing</h2><form onSubmit={e => { e.preventDefault(); void unlock(); }}><label>Operator password<input type="password" value={password} onChange={e => setPassword(e.target.value)}/></label><button type="submit" disabled={auth === "checking"}>Unlock</button></form>{authError && <p role="alert">{authError}</p>}</section>)}
  </div>;
}
