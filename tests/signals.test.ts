import { describe, expect, it } from "vitest";
import { compareSignals, type SignalSnapshot } from "../src/client/lib/signals";

function snapshot(overrides: Partial<SignalSnapshot> = {}): SignalSnapshot {
  return { permissionIds: new Set(), attention: new Map(), taskDoneCount: 0, ...overrides };
}

describe("compareSignals", () => {
  it("asks for input when a new approval card appears", () => {
    const signals = compareSignals(snapshot(), snapshot({ permissionIds: new Set(["r1"]) }));
    expect(signals).toEqual({ needsInput: true, done: false, waitingCount: 1 });
  });

  it("stays quiet when a card is answered and goes away", () => {
    const signals = compareSignals(snapshot({ permissionIds: new Set(["r1"]) }), snapshot());
    expect(signals.needsInput).toBe(false);
  });

  it("asks for input once when several cards and a question arrive together", () => {
    const signals = compareSignals(
      snapshot(),
      snapshot({
        permissionIds: new Set(["r1", "r2"]),
        attention: new Map([["D:\\shop", "The router asked you a question."]]),
      }),
    );
    expect(signals).toEqual({ needsInput: true, done: false, waitingCount: 3 });
  });

  it("doesn't repeat for the same unanswered question", () => {
    const asked = snapshot({ attention: new Map([["D:\\shop", "Which colour?"]]) });
    expect(compareSignals(asked, asked).needsInput).toBe(false);
  });

  it("plays done when a task finished", () => {
    const signals = compareSignals(snapshot({ taskDoneCount: 1 }), snapshot({ taskDoneCount: 3 }));
    expect(signals.done).toBe(true);
  });
});
