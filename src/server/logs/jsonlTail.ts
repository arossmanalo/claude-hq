import { open } from "node:fs/promises";

const CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

export type TailResult = "appended" | "reset";

/**
 * Reads a JSONL file incrementally. Each call to `readNew` delivers only complete lines written
 * since the previous call. A trailing line without a newline is held back, because Claude Code may
 * still be writing it. Splitting happens on raw bytes so a multi-byte character is never cut in half.
 */
export class JsonlTail {
  private offset = 0;
  private remainder: Buffer = Buffer.alloc(0);

  constructor(readonly filePath: string) {}

  /**
   * Calls `onLine` for every new complete line. Returns "reset" when the file shrank (it was
   * rewritten), in which case reading restarted from the beginning and the caller should discard
   * whatever it built from earlier lines before this call.
   */
  async readNew(onLine: (line: string) => void): Promise<TailResult> {
    const handle = await open(this.filePath, "r");
    try {
      const { size } = await handle.stat();
      let result: TailResult = "appended";
      if (size < this.offset) {
        this.offset = 0;
        this.remainder = Buffer.alloc(0);
        result = "reset";
      }
      const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, Math.max(size - this.offset, 1)));
      while (this.offset < size) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        this.emitLines(chunk.subarray(0, bytesRead), onLine);
      }
      return result;
    } finally {
      await handle.close();
    }
  }

  private emitLines(bytes: Buffer, onLine: (line: string) => void): void {
    let data = this.remainder.length > 0 ? Buffer.concat([this.remainder, bytes]) : bytes;
    let start = 0;
    let newline = data.indexOf(NEWLINE, start);
    while (newline !== -1) {
      onLine(data.toString("utf8", start, newline));
      start = newline + 1;
      newline = data.indexOf(NEWLINE, start);
    }
    // Copy so the reusable read buffer can be overwritten safely.
    data = data.subarray(start);
    this.remainder = Buffer.from(data);
  }
}
