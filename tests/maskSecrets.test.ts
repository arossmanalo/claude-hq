import { describe, expect, it } from "vitest";
import { maskSecrets } from "../src/shared/maskSecrets";

describe("maskSecrets", () => {
  it.each([
    ["an Anthropic key", "sk-ant-FAKEFAKEFAKEnotarealkey"],
    ["a GitHub token", "ghp_FAKEFAKEFAKEnotarealtoken00"],
    ["an AWS access key", "AKIAFAKEFAKEFAKEFAKE"],
    ["a JWT", "eyJFAKEFAKEFAKE.eyJFAKEFAKEFAKE.FAKEFAKEFAKEsig"],
  ])("hides %s", (_label, secret) => {
    const masked = maskSecrets(`value: ${secret} end`);
    expect(masked).toContain("••••••");
    expect(masked).not.toContain(secret);
  });

  it("keeps the variable name and hides only the value", () => {
    expect(maskSecrets("DATABASE_PASSWORD=hunter2!")).toBe("DATABASE_PASSWORD=••••••");
    expect(maskSecrets('"api_key": "abc12345"')).toBe('"api_key": "••••••"');
  });

  it("leaves ordinary text alone", () => {
    const text = "Run npm test, then commit the token counter in src/tokens.ts";
    expect(maskSecrets(text)).toBe(text);
  });
});
