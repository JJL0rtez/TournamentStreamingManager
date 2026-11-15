import crypto from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { getNetworkBindAddress } from "./persistent-settings.js";

// Configure a strong password in the server environment. No default password.
const password = process.env.TOURNAMENT_ADMIN_PASSWORD || "";
const remoteEnabled = getNetworkBindAddress() !== "127.0.0.1";
if (remoteEnabled && password.length < 12) {
  throw new Error("Remote API requires TOURNAMENT_ADMIN_PASSWORD (12+ characters)");
}
const salt = crypto.randomBytes(32);
const passwordDigest = password ? crypto.scryptSync(password, salt, 64) : null;
const grants = new Map<string, number>();
const attempts = new Map<string, { count: number; until: number }>();
const GRANT_MS = 15 * 60_000;

function verify(candidate: string): boolean {
  if (!passwordDigest || !candidate) return false;
  const digest = crypto.scryptSync(candidate, salt, 64);
  return crypto.timingSafeEqual(passwordDigest, digest);
}
function hasGrant(req: Request): boolean {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const expiry = grants.get(token);
  if (!expiry) return false;
  if (expiry <= Date.now()) { grants.delete(token); return false; }
  return true;
}
export function installOperatorAuth(app: Express): void {
  app.get("/api/auth/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: Boolean(passwordDigest), unlocked: hasGrant(req), durationMinutes: 15 });
  });
  app.post("/api/auth/unlock", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const address = req.ip || "unknown";
    const previous = attempts.get(address);
    if (previous && previous.until > Date.now() && previous.count >= 5) {
      res.status(429).json({ error: "Too many attempts. Try again in 5 minutes." }); return;
    }
    const candidate = req.body?.password;
    if (typeof candidate !== "string" || !verify(candidate)) {
      const count = previous && previous.until > Date.now() ? previous.count + 1 : 1;
      attempts.set(address, { count, until: Date.now() + 300_000 });
      res.status(401).json({ error: "Incorrect operator password" }); return;
    }
    attempts.delete(address);
    const token = crypto.randomBytes(32).toString("base64url");
    grants.set(token, Date.now() + GRANT_MS);
    res.json({ token, expiresInSeconds: GRANT_MS / 1000 });
  });
  app.post("/api/auth/lock", (req, res) => {
    const header = req.get("authorization") || "";
    if (header.startsWith("Bearer ")) grants.delete(header.slice(7));
    res.json({ success: true });
  });
}
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  if (req.path === "/auth/unlock" || req.path === "/auth/lock") { next(); return; }
  // Existing local-only installations remain usable without a password until configured.
  // Never allow this compatibility mode when bound to a non-loopback interface.
  if (!passwordDigest && !remoteEnabled) { next(); return; }
  // Capture nodes authenticate machine-to-machine using NODE_TOKEN, not operator grants.
  if (process.env.NODE_ROLE === "remote" && req.get("x-tournament-node-token") === process.env.NODE_TOKEN &&
      (process.env.NODE_TOKEN || "").length >= 24) { next(); return; }
  if (!hasGrant(req)) { res.status(403).json({ error: "Operator unlock required", code: "OPERATOR_LOCKED" }); return; }
  next();
}
