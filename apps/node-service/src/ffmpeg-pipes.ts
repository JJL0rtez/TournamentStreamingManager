import type { ChildProcess } from 'node:child_process';

/** A child-process pipe can fail independently of the child itself (EPIPE on
 * Windows/Linux). Register before any writes, including during shutdown. */
export function guardFfmpegPipes(child: ChildProcess, onFailure: (error: Error) => void = () => {}): void {
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on('error', (error: Error) => onFailure(error));
  }
}

export function requestFfmpegQuit(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const kill = () => { if (child.exitCode === null && child.signalCode === null) child.kill(); };
  if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) { kill(); return; }
  try { child.stdin.write('q\n', error => { if (error) kill(); }); }
  catch { kill(); }
}
