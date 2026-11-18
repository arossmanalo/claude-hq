import path from "node:path";

export type Decision =
  | { kind: "allow" }
  | { kind: "deny"; message: string }
  | { kind: "ask"; reason: string };

export interface PolicyInput {
  /** "router" or the subagent type that asked. */
  role: string;
  toolName: string;
  input: Record<string, unknown>;
  /** The project folder the router runs in. */
  cwd: string;
  /** Shell commands approved without asking, matched as whole-command prefixes. */
  safeCommands: readonly string[];
}

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "ToolSearch"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const HANDOFF_TOOLS = new Set(["Agent", "Task"]);

/** Command substitution or multi-line scripts can hide anything, so they're never "safe". */
const SUBSTITUTION = /`|\$\(|\$\{|\n/;
/** Characters that pipe, redirect or background a command. */
const PIPE_OR_REDIRECT = /[|<>&]/;
const STDERR_TO_STDOUT = /\s+2>&1$/;
const CD_SEGMENT = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/;

const TEST_FILE =
  /(^|[\\/])(tests?|__tests__|e2e|spec|specs|fixtures)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|[\\/])test_[^\\/]+\.py$/i;
const DESIGN_FILE =
  /\.(css|scss|sass|less|styl|html?|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|tsx|jsx|vue|svelte|astro)$/i;

export const DEFAULT_SAFE_COMMANDS = [
  "git status",
  "git diff",
  "git log",
  "git show",
  "git branch",
  "npm test",
  "npm run test",
  "npm run lint",
  "npm run typecheck",
  "npm run build",
  "npx tsc --noEmit",
  "npx vitest run",
] as const;

function isInside(folder: string, target: string): boolean {
  const relative = path.relative(path.resolve(folder), path.resolve(folder, target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function editedPath(input: Record<string, unknown>): string | null {
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * True when every part of a chained command is a safe command, or a `cd` into the project.
 * Agents often write `cd "<project>" && npm test 2>&1`. Anything unusual fails closed: quoting
 * that hides `&&` produces segments that match nothing, so the user is asked.
 */
export function isSafeCommand(command: string, safeCommands: readonly string[], cwd: string): boolean {
  if (SUBSTITUTION.test(command)) return false;
  const segments = command
    .split(/&&|\|\||;/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => {
    const cd = CD_SEGMENT.exec(segment);
    if (cd) {
      const target = cd[1] ?? cd[2] ?? cd[3];
      return target !== undefined && isInside(cwd, target);
    }
    const plain = segment.replace(STDERR_TO_STDOUT, "");
    if (PIPE_OR_REDIRECT.test(plain)) return false;
    return safeCommands.some((safe) => plain === safe || plain.startsWith(`${safe} `));
  });
}

/**
 * Decides one permission request from the router or a specialist. Role limits are enforced here,
 * by the office, because the permission request says which subagent is asking.
 */
export function decide(request: PolicyInput): Decision {
  const { role, toolName, input, cwd } = request;

  if (READ_TOOLS.has(toolName)) return { kind: "allow" };

  if (HANDOFF_TOOLS.has(toolName)) {
    if (role === "router") return { kind: "allow" };
    return {
      kind: "deny",
      message:
        "Specialists don't start their own agents. Finish your part and report back; the router decides who works next.",
    };
  }

  if (EDIT_TOOLS.has(toolName)) {
    const target = editedPath(input);
    if (!target) return { kind: "ask", reason: "Edit without a file path" };
    if (!isInside(cwd, target)) return { kind: "ask", reason: "Writes outside the project folder" };
    if (role === "reviewer") {
      return {
        kind: "deny",
        message:
          "Reviewers only read. List the changes you'd make and the router will hand them to the coder.",
      };
    }
    if (role === "tester" && !TEST_FILE.test(target)) {
      return {
        kind: "deny",
        message: `Testers change test files only, not ${path.basename(target)}. Report the failing behaviour and the router will send it to the coder.`,
      };
    }
    if (role === "designer" && !DESIGN_FILE.test(target)) {
      return {
        kind: "deny",
        message: `Designers change styles, markup and assets only, not ${path.basename(target)}. Describe the logic change and the router will send it to the coder.`,
      };
    }
    return { kind: "allow" };
  }

  if (SHELL_TOOLS.has(toolName)) {
    const command = typeof input.command === "string" ? input.command : "";
    if (isSafeCommand(command, request.safeCommands, cwd)) return { kind: "allow" };
    if (role === "reviewer") {
      return {
        kind: "deny",
        message: "Reviewers only read: run read-only commands such as git diff or the test suite.",
      };
    }
    return { kind: "ask", reason: "Runs a shell command" };
  }

  return { kind: "ask", reason: `Uses ${toolName}` };
}

/** One line describing what the tool will do, for the approval card. */
export function summariseToolInput(toolName: string, input: Record<string, unknown>): string {
  const pick = (key: string) => (typeof input[key] === "string" ? String(input[key]) : null);
  const text =
    pick("command") ??
    pick("file_path") ??
    pick("notebook_path") ??
    pick("url") ??
    pick("pattern") ??
    pick("description") ??
    JSON.stringify(input);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return `${toolName}: ${oneLine.length > 300 ? `${oneLine.slice(0, 299)}…` : oneLine}`;
}
