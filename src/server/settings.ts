import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_SAFE_COMMANDS } from "./router/permissionPolicy";

export const settingsSchema = z.object({
  /** Shell commands any agent may run without asking (whole-command prefixes). */
  safeCommands: z.array(z.string().min(1)).default([...DEFAULT_SAFE_COMMANDS]),
  /** Agent handoffs the router may make for one request before it pauses and asks. */
  handoffCap: z.number().int().min(1).max(20).default(6),
  sound: z
    .object({
      muted: z.boolean().default(false),
      volume: z.number().min(0).max(1).default(0.6),
    })
    .default({ muted: false, volume: 0.6 }),
});

export type OfficeSettings = z.infer<typeof settingsSchema>;

export class SettingsFile {
  private current: OfficeSettings = settingsSchema.parse({});

  constructor(private readonly filePath: string) {}

  get value(): OfficeSettings {
    return this.current;
  }

  /**
   * Loads the file. A missing file means defaults. A broken file is left alone (it's the user's)
   * and reported, and defaults apply until it's fixed.
   */
  async load(): Promise<string | null> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    try {
      const parsed = settingsSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        this.current = parsed.data;
        return null;
      }
      return `${this.filePath} has invalid settings (${parsed.error.issues[0]?.message ?? "unknown"}). Using defaults until it's fixed.`;
    } catch {
      return `${this.filePath} isn't valid JSON. Using default settings until it's fixed.`;
    }
  }

  async update(change: (current: OfficeSettings) => OfficeSettings): Promise<OfficeSettings> {
    const next = settingsSchema.parse(change(this.current));
    await writeJsonAtomically(this.filePath, next);
    this.current = next;
    return next;
  }
}

/** Writes to a temporary file and renames it, so a crash never leaves half a file. */
export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}
