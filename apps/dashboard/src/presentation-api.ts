import { operatorApi } from "./operator-api";
/** Same-origin display requests; preserve HTTP status for revision conflicts. */
export function presentationFetch(url: string, options?: RequestInit) {
  if (!url.startsWith("/api/")) throw new Error("Invalid display API path");
  const headers = new Headers(options?.headers);
  const token = operatorApi.getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
