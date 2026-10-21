import { describe, expect, it } from "vitest";
import { blockClasses } from "./markdownStyling.ts";
import { stateOf } from "./testing.ts";

describe("block styling in a clipped viewport", () => {
  it("keeps code styling at both clipped edges of a large fenced block", () => {
    const state = stateOf(`Before.\n\n\`\`\`text\n${"code\n".repeat(20_000)}\`\`\`\n\nAfter.`);
    const from = state.doc.line(10_000).from + 2;
    const to = state.doc.line(10_010).from + 2;
    const styles = blockClasses({ state, visibleRanges: [{ from, to }] });
    const lines: number[] = [];
    styles.between(0, state.doc.length, (pos, _end, deco) => {
      expect((deco.spec as { class: string }).class).toBe("cm-codeblock");
      lines.push(state.doc.lineAt(pos).number);
    });
    expect(lines).toEqual(Array.from({ length: 11 }, (_, i) => 10_000 + i));
  });

  it("combines quote and code classes and retains adjacent heading spacing", () => {
    const state = stateOf("> before\n>\n> ```\n> code\n> ```\n\nText\n## Heading\nMore");
    const styles = blockClasses({ state, visibleRanges: [{ from: 0, to: state.doc.length }] });
    const lines = new Map<number, string>();
    styles.between(0, state.doc.length, (pos, _end, deco) => {
      lines.set(state.doc.lineAt(pos).number, (deco.spec as { class: string }).class);
    });
    expect(lines.get(4)).toBe("cm-quote cm-codeblock");
    expect(lines.get(8)).toBe("cm-h2 cm-h-joined-above cm-h-joined-below");
  });
});
