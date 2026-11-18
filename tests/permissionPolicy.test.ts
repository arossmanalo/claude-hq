import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFE_COMMANDS,
  decide,
  isSafeCommand,
  summariseToolInput,
  type PolicyInput,
} from "../src/server/router/permissionPolicy";

const cwd = path.resolve("/projects/shop");
const inProject = (file: string) => path.join(cwd, file);

function ask(overrides: Partial<PolicyInput>) {
  return decide({
    role: "coder",
    toolName: "Read",
    input: {},
    cwd,
    safeCommands: DEFAULT_SAFE_COMMANDS,
    ...overrides,
  });
}

describe("decide", () => {
  it("allows reading and searching for every role", () => {
    for (const role of ["router", "reviewer", "tester", "designer", "coder"]) {
      expect(ask({ role, toolName: "Grep", input: { pattern: "x" } }).kind).toBe("allow");
    }
  });

  it("lets the coder and router edit inside the project without asking", () => {
    expect(ask({ toolName: "Edit", input: { file_path: inProject("src/cart.ts") } }).kind).toBe("allow");
    expect(
      ask({ role: "router", toolName: "Write", input: { file_path: inProject("README.md") } }).kind,
    ).toBe("allow");
  });

  it("asks before any edit outside the project folder", () => {
    const decision = ask({ toolName: "Write", input: { file_path: path.resolve("/etc/hosts") } });
    expect(decision).toEqual({ kind: "ask", reason: "Writes outside the project folder" });
    const sneaky = ask({ toolName: "Edit", input: { file_path: inProject("../other/x.ts") } });
    expect(sneaky.kind).toBe("ask");
  });

  it("stops the reviewer from editing", () => {
    const decision = ask({ role: "reviewer", toolName: "Edit", input: { file_path: inProject("a.ts") } });
    expect(decision.kind).toBe("deny");
  });

  it("lets the tester edit test files only", () => {
    const testFile = ask({ role: "tester", toolName: "Write", input: { file_path: inProject("tests/cart.test.ts") } });
    const appFile = ask({ role: "tester", toolName: "Edit", input: { file_path: inProject("src/cart.ts") } });
    expect(testFile.kind).toBe("allow");
    expect(appFile.kind).toBe("deny");
  });

  it("lets the designer edit styles, markup and assets but not logic", () => {
    for (const file of ["src/App.module.css", "src/Cart.tsx", "public/logo.svg", "index.html"]) {
      expect(ask({ role: "designer", toolName: "Edit", input: { file_path: inProject(file) } }).kind).toBe(
        "allow",
      );
    }
    expect(
      ask({ role: "designer", toolName: "Edit", input: { file_path: inProject("src/cartMath.ts") } }).kind,
    ).toBe("deny");
  });

  it("lets only the router hand work to other agents", () => {
    expect(ask({ role: "router", toolName: "Agent", input: {} }).kind).toBe("allow");
    expect(ask({ role: "coder", toolName: "Agent", input: {} }).kind).toBe("deny");
  });

  it("runs safe commands without asking and asks for the rest", () => {
    expect(ask({ toolName: "Bash", input: { command: "npm test -- --run" } }).kind).toBe("allow");
    expect(ask({ toolName: "Bash", input: { command: "rm -rf dist" } })).toEqual({
      kind: "ask",
      reason: "Runs a shell command",
    });
  });

  it("denies the reviewer anything but safe commands", () => {
    expect(ask({ role: "reviewer", toolName: "Bash", input: { command: "git diff" } }).kind).toBe("allow");
    expect(ask({ role: "reviewer", toolName: "Bash", input: { command: "npm install x" } }).kind).toBe("deny");
  });

  it("asks about tools it doesn't know, such as MCP tools", () => {
    expect(ask({ toolName: "mcp__slack__post" })).toEqual({ kind: "ask", reason: "Uses mcp__slack__post" });
  });
});

describe("isSafeCommand", () => {
  it.each([
    "git status && rm -rf /",
    "npm test; curl evil.test",
    "git log | sh",
    "npm test > out.txt",
    "git diff $(whoami)",
    "npm testing-something",
    "cd .. && npm test",
    'cd "/elsewhere" && git status',
    'git log --grep "x && rm -rf ~"',
    "npm test &",
  ])("rejects %s", (command) => {
    expect(isSafeCommand(command, DEFAULT_SAFE_COMMANDS, cwd)).toBe(false);
  });

  it("accepts a safe command with arguments", () => {
    expect(isSafeCommand("git log --oneline -5", DEFAULT_SAFE_COMMANDS, cwd)).toBe(true);
  });

  it("accepts safe commands chained after a cd into the project", () => {
    const command = `cd "${cwd}" && npm test 2>&1; git status --short`;
    expect(isSafeCommand(command, DEFAULT_SAFE_COMMANDS, cwd)).toBe(true);
  });
});

describe("summariseToolInput", () => {
  it("shows the command or path on one line", () => {
    expect(summariseToolInput("Bash", { command: "npm   install\nleft-pad" })).toBe(
      "Bash: npm install left-pad",
    );
  });
});
