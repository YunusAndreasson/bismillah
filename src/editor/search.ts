import { closeSearchPanel, getSearchQuery, openSearchPanel, search } from "@codemirror/search";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { copy } from "../core/copy.ts";

let feedbackId = 0;

/** Add feedback to the editor-owned panel without replacing its matching, keyboard
 * handling or history. Stop at the first match; selection changes never rescan. */
function panelFeedback(): Extension {
  let previous: { state: EditorState; panel: Element } | undefined;
  return EditorView.updateListener.of(({ view }) => {
    const panel = view.dom.querySelector(".cm-search");
    if (!panel) {
      previous = undefined;
      return;
    }
    const query = getSearchQuery(view.state);
    if (
      previous?.panel === panel &&
      previous.state.doc === view.state.doc &&
      getSearchQuery(previous.state).eq(query)
    )
      return;
    previous = { state: view.state, panel };
    let status = panel.querySelector<HTMLElement>(".cm-search-feedback");
    if (!status) {
      status = document.createElement("div");
      status.className = "cm-search-feedback";
      status.id = `search-feedback-${++feedbackId}`;
      status.setAttribute("role", "status");
      panel.append(status);
    }
    const invalid = query.search !== "" && !query.valid;
    const field = panel.querySelector<HTMLInputElement>('input[name="search"]');
    field?.setAttribute("aria-invalid", String(invalid));
    field?.setAttribute("aria-describedby", status.id);
    field?.setAttribute("dir", "auto");
    panel.querySelector('input[name="replace"]')?.setAttribute("dir", "auto");
    status.classList.toggle("invalid", invalid);
    status.textContent = invalid
      ? copy.search.invalidExpression
      : !query.search
        ? copy.search.prompt
        : query.getCursor(view.state).next().done
          ? copy.search.noMatches
          : copy.search.matchFound;
    // WebKitGTK exposes a status region's name separately from its leaf text.
    // Name it explicitly so the field's description also reaches AT-SPI readers.
    status.setAttribute("aria-label", status.textContent);
  });
}

/** CodeMirror owns matching, replacement history and accessible result announcements.
 * App commands own shortcuts: the full search keymap would take Zuhd and Theme's keys.
 */
export function documentSearch(): Extension {
  return [
    search({ top: true }),
    panelFeedback(),
    EditorState.phrases.of({
      next: "Next",
      previous: "Previous",
      "match case": "Match case",
      regexp: "Regular expression",
      "by word": "Whole words",
      replace: "Replace",
      "replace all": "Replace all",
      close: "Close",
      go: "Go",
    }),
    // Closing search takes precedence over Escape's "put the pen down" behavior.
    Prec.highest(
      keymap.of([{ key: "Escape", run: closeSearchPanel, scope: "editor search-panel" }]),
    ),
  ];
}

export function openReplace(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  openSearchPanel(view);
  const field = view.dom.querySelector<HTMLInputElement>('.cm-search [name="replace"]');
  field?.focus();
  field?.select();
  return true;
}
