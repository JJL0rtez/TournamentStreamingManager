import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

export interface RingAssignment {
  cameraId: string;
  cameraName: string;
  microphoneName: string;
  ring: string;
  audioSyncOffsetMs?: number;
  overlay?: { imageId: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; offsetX: number; offsetY: number };
}
export interface TournamentSession {
  eventName: string;
  eventId: string;
  assignments: RingAssignment[];
}
const sessionFile = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || path.join(process.cwd(), "config"), "session.json");
const eventDirectory = path.join(path.dirname(sessionFile), "events");
let session: TournamentSession | null = null;

function saveAtomic(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filename);
}
function eventFile(eventId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(eventId)) throw new Error("Invalid tournament ID.");
  return path.join(eventDirectory, `${eventId}.json`);
}
function archiveSession(value: TournamentSession): void {
  saveAtomic(eventFile(value.eventId), value);
}
export function listTournamentEvents(): Array<{ eventId: string; eventName: string; assignmentCount: number }> {
  const events = new Map<string, { eventId: string; eventName: string; assignmentCount: number }>();
  if (fs.existsSync(eventDirectory)) {
    for (const filename of fs.readdirSync(eventDirectory)) {
      if (!filename.endsWith(".json")) continue;
      try {
        const value = JSON.parse(fs.readFileSync(path.join(eventDirectory, filename), "utf8")) as TournamentSession;
        if (value.eventId && filename === `${value.eventId}.json` && typeof value.eventName === "string" && Array.isArray(value.assignments)) {
          events.set(value.eventId, { eventId: value.eventId, eventName: value.eventName, assignmentCount: value.assignments.length });
        }
      } catch (error) { console.warn("Skipping invalid archived tournament:", filename, error); }
    }
  }
  if (session) events.set(session.eventId, { eventId: session.eventId, eventName: session.eventName, assignmentCount: session.assignments.length });
  return [...events.values()].sort((a,b) => a.eventName.localeCompare(b.eventName));
}
export function selectTournamentEvent(eventId: string): TournamentSession {
  if (session?.eventId === eventId) return session;
  const filename = eventFile(eventId);
  const selected = JSON.parse(fs.readFileSync(filename, "utf8")) as TournamentSession;
  if (selected.eventId !== eventId || typeof selected.eventName !== "string" || !Array.isArray(selected.assignments)) {
    throw new Error("Archived tournament is invalid.");
  }
  // Save current event before switching. Do not change the selected UUID.
  if (session) archiveSession(session);
  saveAtomic(sessionFile, selected);
  session = selected;
  return selected;
}

try { if (fs.existsSync(sessionFile)) session = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as TournamentSession; }
catch (error) { console.error("Could not load saved tournament session:", error); }
if (session && !session.eventId) {
  session.eventId = randomUUID();
  saveAtomic(sessionFile, session);
}
export function safeRecordingName(value: string): string { return safeName(value); }

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9 _-]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}
export function getSession(): TournamentSession | null { return session; }
export function setSession(input: unknown, createNewEvent = false): TournamentSession {
  if (!input || typeof input !== "object") throw new Error("Invalid session.");
  const value = input as Partial<TournamentSession>;
  if (typeof value.eventName !== "string" || !safeName(value.eventName) || !Array.isArray(value.assignments))
    throw new Error("Event name and assignments are required.");
  if (value.assignments.length > 8) throw new Error("Maximum 8 camera assignments per node.");
  const seenCameras = new Set<string>();
  const seenMicrophones = new Set<string>();
  const seenRings = new Set<string>();
  const assignments = value.assignments.map((item) => {
    if (!item || !["cameraId","cameraName","microphoneName","ring"].every(
      (key) => typeof item[key as keyof RingAssignment] === "string" &&
      String(item[key as keyof RingAssignment]).trim()))
      throw new Error("Every assignment requires a camera, microphone and ring.");
    const ring = safeName(item.ring);
    if (!ring) throw new Error("Invalid ring name.");
    if (seenCameras.has(item.cameraId) || seenMicrophones.has(item.microphoneName) || seenRings.has(ring))
      throw new Error("Camera, microphone and ring assignments must be unique.");
    seenCameras.add(item.cameraId); seenMicrophones.add(item.microphoneName); seenRings.add(ring);
    const audioSyncOffsetMs = item.audioSyncOffsetMs ?? -300;
    if (typeof audioSyncOffsetMs !== "number" || !Number.isInteger(audioSyncOffsetMs) ||
        audioSyncOffsetMs < -2000 || audioSyncOffsetMs > 2000)
      throw new Error("Audio sync offset must be an integer between -2000 and 2000 ms.");
    const overlay = item.overlay;
    if (overlay !== undefined && (!overlay || typeof overlay !== "object" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}\.(png|jpg)$/i.test(overlay.imageId) ||
      !["top-left", "top-right", "bottom-left", "bottom-right"].includes(overlay.position) ||
      !Number.isInteger(overlay.offsetX) || !Number.isInteger(overlay.offsetY) ||
      overlay.offsetX < -4096 || overlay.offsetX > 4096 || overlay.offsetY < -4096 || overlay.offsetY > 4096)) {
      throw new Error("Invalid overlay settings.");
    }
    return { cameraId: item.cameraId, cameraName: item.cameraName,
      microphoneName: item.microphoneName, ring, audioSyncOffsetMs, ...(overlay ? { overlay } : {}) };
  });
  // Never trust an event ID from the client. Generate it on the server.
  const eventId = createNewEvent || !session ? randomUUID() : session.eventId;
  const next = { eventId, eventName: safeName(value.eventName), assignments };
  if (session) archiveSession(session);
  saveAtomic(sessionFile, next);
  archiveSession(next);
  session = next;
  return session;
}
// Persist the currently selected event in the archive for later re-selection.
if (session) archiveSession(session);

// Templates are reusable setup presets, not historical tournament sessions.
// Applying one never changes an event UUID or writes a tournament session.
const templateDirectory = path.join(path.dirname(sessionFile), "templates");
export interface TournamentTemplate {
  templateId: string;
  name: string;
  eventName: string;
  assignments: RingAssignment[];
  createdAt: string;
}
function templateFile(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) throw new Error("Invalid template ID.");
  return path.join(templateDirectory, `${id}.json`);
}
function readTemplate(id: string): TournamentTemplate {
  const value = JSON.parse(fs.readFileSync(templateFile(id), "utf8")) as TournamentTemplate;
  if (value.templateId !== id || typeof value.name !== "string" ||
      typeof value.eventName !== "string" || !Array.isArray(value.assignments)) {
    throw new Error("Invalid template file.");
  }
  return value;
}
export function listTournamentTemplates(): Array<Pick<TournamentTemplate, "templateId" | "name" | "eventName" | "createdAt"> & { assignmentCount: number }> {
  if (!fs.existsSync(templateDirectory)) return [];
  return fs.readdirSync(templateDirectory).filter(n => n.endsWith(".json")).flatMap(filename => {
    try {
      const value = readTemplate(filename.slice(0, -5));
      return [{ templateId: value.templateId, name: value.name, eventName: value.eventName,
        createdAt: value.createdAt, assignmentCount: value.assignments.length }];
    } catch (error) { console.warn("Skipping invalid template", filename, error); return []; }
  }).sort((a,b) => a.name.localeCompare(b.name));
}
export function getTournamentTemplate(id: string): TournamentTemplate { return readTemplate(id); }
export function saveTournamentTemplate(name: unknown): TournamentTemplate {
  if (!session) throw new Error("Save a tournament session before creating a template.");
  if (typeof name !== "string" || !name.trim() || name.length > 80) throw new Error("Template name must be 1 to 80 characters.");
  const value: TournamentTemplate = {
    templateId: randomUUID(), name: name.trim(), eventName: session.eventName,
    assignments: session.assignments.map(a => ({ ...a })), createdAt: new Date().toISOString()
  };
  saveAtomic(templateFile(value.templateId), value);
  return value;
}

export function recordingDirectory(base: string, cameraId: string): string {
  const assignment = session?.assignments.find((item) => item.cameraId === cameraId);
  return assignment ? path.join(base, session!.eventName, assignment.ring) : base;
}
