import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { markdownDialect } from "./dialect.ts";

/** An EditorState with the bismillah dialect and a fully parsed tree, for unit tests. */
export function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdownDialect()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  // The parse above advances the parser, but `syntaxTree(state)` only sees the finished
  // tree after a transaction (the initial parse has a small time budget).
  return state.update({}).state;
}
