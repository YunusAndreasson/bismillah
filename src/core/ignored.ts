/**
 * What the writer chose to *Ignore*, per document, for this app session
 * (ARCHITECTURE.md §7.4). Nothing is written to disk; reopening the document later in
 * the session keeps it, quitting forgets it.
 */
export class IgnoredWords {
  #byDocument = new Map<string, Set<string>>();

  /** A copy of what is ignored in a document. */
  of(document: string): ReadonlySet<string> {
    return new Set(this.#byDocument.get(document));
  }

  /** Ignores `key` in a document; returns what is ignored there now. */
  add(document: string, key: string): ReadonlySet<string> {
    const set = this.#byDocument.get(document) ?? new Set<string>();
    set.add(key);
    this.#byDocument.set(document, set);
    return new Set(set);
  }
}
