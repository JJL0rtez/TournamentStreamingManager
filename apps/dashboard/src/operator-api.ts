/** One GET in flight per URL, session and request header set. No mutation is
 * ever retried or deduplicated. A mutation invalidates the read generation. */
export function createOperatorRequest(fetcher: typeof fetch = fetch) {
  let token = "";
  let generation = 0;
  const pending = new Map<string, Promise<any>>();
  function setToken(next: string) { token = next; generation++; pending.clear(); }
  function getToken() { return token; }
  async function request(url: string, options?: RequestInit): Promise<any> {
    const method = (options?.method ?? "GET").toUpperCase();
    const headers = new Headers(options?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // A caller's AbortSignal must never cancel another caller's read.
    const share = method === "GET" && !options?.signal && !options?.body;
    if (method !== "GET" && method !== "HEAD") { generation++; pending.clear(); }
    const key = JSON.stringify([generation, url, [...headers.entries()].sort(), options?.credentials, options?.cache, options?.redirect, options?.mode]);
    if (share && pending.has(key)) return pending.get(key)!;
    const work = (async () => {
      const response = await fetcher(url, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : `Request failed (${response.status})`;
        throw new Error(message);
      }
      return data;
    })();
    if (share) pending.set(key, work);
    try { return await work; }
    finally {
      if (share && pending.get(key) === work) pending.delete(key);
      if (method !== "GET" && method !== "HEAD") { generation++; pending.clear(); }
    }
  }
  return { request, setToken, getToken };
}
export const operatorApi = createOperatorRequest();
