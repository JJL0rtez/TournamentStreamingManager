import type { Express } from 'express';
import { runIncidentReplay, compareReplayReports } from './incident-replay.js';
/** These endpoints operate on synthetic JSON only, never invoke the capture manager. */
export function installIncidentReplayRoutes(app: Express) {
  app.post('/api/simulation/replay', (req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(runIncidentReplay(req.body)); }
    catch(error) { res.status(400).json({error:error instanceof Error?error.message:String(error)}); }
  });
  app.post('/api/simulation/compare', (req,res) => {
    try {
      const body=req.body as {baseline:unknown;candidate:unknown};
      if(!body || !body.baseline || !body.candidate) throw new Error('Baseline and candidate required');
      res.setHeader('Cache-Control','no-store');
      res.json(compareReplayReports(runIncidentReplay(body.baseline),runIncidentReplay(body.candidate)));
    } catch(error) {res.status(400).json({error:error instanceof Error?error.message:String(error)});}
  });
}
