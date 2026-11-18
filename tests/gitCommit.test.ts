import { describe, expect, it } from "vitest";
import { isGitCommitCommand, parseCommit } from "../src/server/logs/gitCommit";

describe("isGitCommitCommand", () => {
  it.each([
    "git commit -m 'x'",
    'git add a.ts && git commit -q -m "x" && git push',
    'git -C "D:/repo" commit -qm "x"',
  ])("recognises %s", (command) => {
    expect(isGitCommitCommand(command)).toBe(true);
  });

  it.each(["git log --oneline", "echo 'remember to git push'", "npm run commit-lint"])(
    "ignores %s",
    (command) => {
      expect(isGitCommitCommand(command)).toBe(false);
    },
  );
});

describe("parseCommit", () => {
  it("prefers git's own summary line, which has the hash", () => {
    expect(parseCommit('git commit -m "ignored"', "[main 3f9c2ab] feat: real\n 1 file")).toEqual({
      hash: "3f9c2ab",
      message: "feat: real",
    });
  });

  it("reads the root-commit summary format", () => {
    expect(parseCommit("git commit -m x", "[main (root-commit) a45588f] build: init")).toEqual({
      hash: "a45588f",
      message: "build: init",
    });
  });

  it("falls back to the -m message when -q hides the summary", () => {
    expect(parseCommit('git commit -q -m "fix(api): keep \\"quoted\\" text"', "")).toEqual({
      hash: null,
      message: 'fix(api): keep "quoted" text',
    });
  });

  it("takes only the first line of a multi-paragraph message", () => {
    expect(parseCommit("git commit -qm 'feat: one\n\nbody text'", "")).toEqual({
      hash: null,
      message: "feat: one",
    });
  });

  it("reads a bash heredoc message", () => {
    const command = 'git commit -q -m "$(cat <<\'EOF\'\ndocs: add setup\n\nBody\nEOF\n)"';
    expect(parseCommit(command, "")?.message).toBe("docs: add setup");
  });

  it("reads a PowerShell here-string message", () => {
    expect(parseCommit("git commit -m @'\ntest(sim): cover ticks\n'@", "")?.message).toBe(
      "test(sim): cover ticks",
    );
  });

  it("gives up when neither the output nor the command has a message", () => {
    expect(parseCommit("git commit", "")).toBeNull();
  });
});
