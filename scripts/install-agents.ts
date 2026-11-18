import path from "node:path";
import { fileURLToPath } from "node:url";
import { installAgents } from "../src/server/installAgents";
import { claudeHome } from "../src/server/paths";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const target = path.join(claudeHome(), "agents");

const MESSAGES = {
  installed: "installed",
  unchanged: "already up to date",
  updated: "updated (you had not changed it)",
  "kept-yours": "kept your edited copy (run with --force to replace it)",
  replaced: "replaced your copy",
} as const;

installAgents(path.join(repoRoot, "agents"), target, force)
  .then((results) => {
    console.log(`Agent team in ${target}:`);
    for (const { file, outcome } of results) console.log(`  ${file}: ${MESSAGES[outcome]}`);
  })
  .catch((error: unknown) => {
    console.error(`Couldn't install the agents: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
