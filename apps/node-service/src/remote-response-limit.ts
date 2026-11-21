/** Read a remote response without trusting Content-Length. Never buffer indefinitely. */
export class RemoteResponseTooLarge extends Error {
  constructor() { super("Upstream response exceeds size limit"); }
}
export async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("Invalid response size limit");
  const header = response.headers.get("content-length");
  if (header !== null) {
    const declared = Number(header);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      await response.body?.cancel();
      throw new RemoteResponseTooLarge();
    }
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RemoteResponseTooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}
