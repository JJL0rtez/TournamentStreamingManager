export type MicrophoneDevice = { id: string; name: string };
/** Never silently switch away from an explicit physical assignment. */
export function chooseMicrophone(camera: MicrophoneDevice, microphones: MicrophoneDevice[], explicitId?: string,
  savedIdentity?: string, assignedName?: string): MicrophoneDevice | null {
  if (explicitId) return microphones.find(mic=>mic.id===explicitId) ?? null;
  if (savedIdentity) {
    const exact = microphones.find(mic=>mic.id===savedIdentity); if (exact) return exact;
    const sameName = microphones.filter(mic=>mic.name===savedIdentity);
    return sameName.length===1 ? sameName[0] : null;
  }
  if (assignedName) {
    const matches = microphones.filter(mic=>mic.name===assignedName);
    return matches.length===1 ? matches[0] : null;
  }
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const name=normalize(camera.name);
  const matches=microphones.filter(mic=>name.length>=6&&normalize(mic.name).includes(name));
  return matches.length===1 ? matches[0] : null;
}
