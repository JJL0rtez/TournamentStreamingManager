/** Select samples across the entire recording, including the first and final segment. */
export function selectSegmentSamples<T>(segments: readonly T[], maximum: number): T[] {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 200) {
    throw new RangeError("maxSegments must be an integer between 1 and 200");
  }
  if (segments.length <= maximum) return [...segments];
  if (maximum === 1) return [segments[segments.length - 1]];
  const indices = new Set<number>();
  for (let i = 0; i < maximum; i++) {
    indices.add(Math.floor(i * (segments.length - 1) / (maximum - 1)));
  }
  return [...indices].sort((a, b) => a - b).map(i => segments[i]);
}

