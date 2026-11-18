/** Matches git's commit summary line, e.g. "[main (root-commit) a45588f] build: scaffold". */
const SUMMARY_LINE = /\[[^\]\n]*?\b([0-9a-f]{7,40})\] ([^\n]+)/;

/** `git ... commit`, allowing options such as `-C dir` between the two words. */
const GIT_COMMIT = /\bgit\b(?:\s+-{1,2}[^\s]+(?:\s+[^\s-][^\s]*)?)*\s+commit\b/;

/**
 * The first line of the message passed with `-m` (or `-qm`, `-am`, `--message`), as a double-
 * or single-quoted string, a bash heredoc, or a PowerShell here-string.
 */
const MESSAGE_PATTERNS: RegExp[] = [
  // The heredoc form is also a double-quoted string, so it has to be tried first.
  /(?:\s-[a-zA-Z]*m|\s--message)[\s=]+"?\$\(cat\s+<<-?\s*'?(\w+)'?\s*\n([^\n]*)/,
  /(?:\s-[a-zA-Z]*m|\s--message)[\s=]+@['"]\r?\n([^\r\n]*)/,
  /(?:\s-[a-zA-Z]*m|\s--message)[\s=]+"((?:[^"\\]|\\.)*)"/,
  /(?:\s-[a-zA-Z]*m|\s--message)[\s=]+'([^']*)'/,
];

export function isGitCommitCommand(command: string): boolean {
  return GIT_COMMIT.test(command);
}

export function commitMessageFromCommand(command: string): string | null {
  for (const pattern of MESSAGE_PATTERNS) {
    const match = pattern.exec(command);
    if (!match) continue;
    // The heredoc pattern captures the delimiter first and the message line second.
    const text = match.length > 2 ? match[2] : match[1];
    const firstLine = text?.split(/\\n|\n/)[0]?.replace(/\\(["\\$`])/g, "$1").trim();
    if (firstLine) return firstLine;
  }
  return null;
}

export interface ParsedCommit {
  hash: string | null;
  message: string;
}

/**
 * Combines what the command said with what git printed. `git commit -q` prints nothing, so the
 * hash can be missing; the message then comes from the command line.
 */
export function parseCommit(command: string, output: string): ParsedCommit | null {
  const summary = SUMMARY_LINE.exec(output);
  if (summary?.[1] && summary[2]) return { hash: summary[1], message: summary[2].trim() };
  const message = commitMessageFromCommand(command);
  return message ? { hash: null, message } : null;
}