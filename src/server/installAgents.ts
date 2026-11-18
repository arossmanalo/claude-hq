import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type InstallOutcome = "installed" | "unchanged" | "kept-yours" | "replaced";

export interface InstallResult {
  file: string;
  outcome: InstallOutcome;
}

async function readOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Copies the office's agent definitions into Claude Code's agents folder. An existing file with
 * different content is the user's edit and is kept unless `force` is set.
 */
export async function installAgents(
  sourceDir: string,
  targetDir: string,
  force: boolean,
): Promise<InstallResult[]> {
  await mkdir(targetDir, { recursive: true });
  const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".md")).sort();
  const results: InstallResult[] = [];
  for (const file of files) {
    const source = path.join(sourceDir, file);
    const target = path.join(targetDir, file);
    const [wanted, existing] = await Promise.all([readFile(source, "utf8"), readOrNull(target)]);
    if (existing === wanted) {
      results.push({ file, outcome: "unchanged" });
      continue;
    }
    if (existing !== null && !force) {
      results.push({ file, outcome: "kept-yours" });
      continue;
    }
    await copyFile(source, target);
    results.push({ file, outcome: existing === null ? "installed" : "replaced" });
  }
  return results;
}
