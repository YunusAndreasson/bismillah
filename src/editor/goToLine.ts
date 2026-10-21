import { gotoLine } from "@codemirror/search";
import { getDialog, type EditorView } from "@codemirror/view";
import { copy } from "../core/copy.ts";

let nextId = 0;

/** Keep CodeMirror's navigation and focus handling, but make its input contract
 * visible and keep mistakes in the panel so they can be corrected. */
export function openGoToLine(view: EditorView): boolean {
  gotoLine(view);
  const panel = getDialog(view, "cm-goto-line")?.dom;
  const form = panel?.querySelector("form");
  const field = form?.querySelector("input");
  if (!panel || !form || !field || panel.querySelector(".cm-navigation-feedback")) return true;

  const feedback = document.createElement("div");
  feedback.className = "cm-navigation-feedback";
  feedback.id = `navigation-feedback-${++nextId}`;
  feedback.setAttribute("role", "status");
  panel.append(feedback);
  field.setAttribute("aria-describedby", feedback.id);

  const explain = (invalid: boolean): void => {
    const message = invalid ? copy.navigation.invalid : copy.navigation.hint;
    feedback.textContent = message;
    feedback.setAttribute("aria-label", message);
    feedback.classList.toggle("invalid", invalid);
    field.setAttribute("aria-invalid", String(invalid));
  };
  // Same forms CodeMirror understands, requiring a number rather than accepting
  // an empty field or a bare sign. Parsing, clamping and movement stay in CodeMirror.
  const valid = () => /^(?:[+-]?\d+(?::\d+)?%?|:\d+)$/.test(field.value.trim());
  const validate = (event: Event): void => {
    if (valid()) {
      field.value = field.value.trim();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    explain(true);
    field.focus();
    field.select();
  };
  form.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") validate(event);
    },
    true,
  );
  form.addEventListener("submit", validate, true);
  field.addEventListener("input", () => {
    if (valid()) explain(false);
  });
  explain(false);
  return true;
}
