import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type InstallOutcome = "installed" | "unchanged" | "updated" | "kept-yours" | "replaced";

export interface InstallResult {
  file: string;
  outcome: InstallOutcome;
}

/** Records what the office installed, so a later run can tell its own old copy from your edit. */
const MANIFEST = ".claude-office-agents.json";
const manifestSchema = z.record(z.string(), z.string());

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readManifest(targetDir: string): Promise<Record<string, string>> {
  const text = await readOrNull(path.join(targetDir, MANIFEST));
  if (text === null) return {};
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    // A broken manifest only means every differing file is treated as the user's.
    return {};
  }
}

/**
 * Copies the office's agent definitions into Claude Code's agents folder.
 * - A file that still matches what the office installed last time is updated.
 * - A file that differs from that is the user's edit, and is kept unless `force` is set.
 */
export async function installAgents(
  sourceDir: string,
  targetDir: string,
  force: boolean,
): Promise<InstallResult[]> {
  await mkdir(targetDir, { recursive: true });
  const manifest = await readManifest(targetDir);
  const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".md")).sort();
  const results: InstallResult[] = [];

  for (const file of files) {
    const target = path.join(targetDir, file);
    const [wanted, existing] = await Promise.all([
      readFile(path.join(sourceDir, file), "utf8"),
      readOrNull(target),
    ]);
    let outcome: InstallOutcome;
    if (existing === wanted) {
      outcome = "unchanged";
    } else if (existing === null) {
      outcome = "installed";
    } else if (manifest[file] === sha256(existing)) {
      outcome = "updated";
    } else if (force) {
      outcome = "replaced";
    } else {
      results.push({ file, outcome: "kept-yours" });
      continue;
    }
    if (outcome !== "unchanged") await writeFile(target, wanted, "utf8");
    manifest[file] = sha256(wanted);
    results.push({ file, outcome });
  }

  await writeFile(path.join(targetDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return results;
}
