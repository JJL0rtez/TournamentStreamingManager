// Read-only API smoke test. Never starts or stops cameras or YouTube streams.
const base = process.env.TOURNAMENT_API_URL ?? 'http://127.0.0.1:3001';
const endpoints = ['/api/health', '/api/session', '/api/youtube/streams', '/api/captures'];
let failures = 0;
for (const endpoint of endpoints) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(new URL(endpoint, base), { signal: controller.signal, headers: { Accept: 'application/json' } });
    const body = await response.text();
    const json = (() => { try { return JSON.parse(body); } catch { return null; } })();
    const pass = response.ok && json !== null;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${endpoint}: HTTP ${response.status}${!pass ? ' (expected successful JSON response)' : ''}`);
    if (!pass) failures++;
  } catch (error) {
    failures++;
    console.log(`FAIL ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  } finally { clearTimeout(timeout); }
}
console.log(`\nRead-only API smoke checks: ${endpoints.length - failures}/${endpoints.length}`);
if (failures) process.exitCode = 1;
