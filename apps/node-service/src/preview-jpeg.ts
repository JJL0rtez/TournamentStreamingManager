const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_BUFFER = 8 * 1024 * 1024;
/** Retain a split JPEG marker across stdout chunks; discard invalid large data. */
export class PreviewJpegParser {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer, onFrame: (frame: Buffer) => void): void {
    if (chunk.length > MAX_BUFFER) { this.buffer = Buffer.alloc(0); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const start = this.buffer.indexOf(SOI);
      if (start < 0) { this.buffer = this.buffer[this.buffer.length - 1] === 0xff ? Buffer.from([0xff]) : Buffer.alloc(0); return; }
      const end = this.buffer.indexOf(EOI, start + 2);
      if (end < 0) { this.buffer = this.buffer.length - start > MAX_BUFFER ? Buffer.alloc(0) : Buffer.from(this.buffer.subarray(start)); return; }
      if (end + 2 - start <= MAX_BUFFER) onFrame(Buffer.from(this.buffer.subarray(start, end + 2)));
      this.buffer = this.buffer.subarray(end + 2);
    }
  }
}
