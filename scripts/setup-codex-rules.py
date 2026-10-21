#!/usr/bin/env python3
"""Install project-scoped Codex approvals; --check validates without installing."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


SCRIPTS = [
    "verify", "check", "lint", "test", "build", "app:build", "app:shot",
    "test:e2e", "test:visual", "test:offline", "a11y", "perf",
]
RULES = [
    (["pnpm", SCRIPTS + ["audit", "outdated"]], "Project checks, builds, screenshots and dependency audits."),
    (["pnpm", "run", SCRIPTS], "The same project scripts with explicit pnpm run."),
    (["cargo", ["check", "test", "clippy", "fmt"]], "Rust compilation, tests, linting and formatting."),
    (["cargo", "deny", "check"], "Rust advisory, license and dependency policy checks."),
]


def render_rules():
    text = (
        "# bismillah: routine development commands approved by the author.\n"
        "# Loaded only through this trusted project's .codex layer.\n"
        "# These commands and their subprocesses may run outside the sandbox.\n"
        "# Keep scripts reviewable; no generic shell/interpreter permissions.\n\n"
    )
    for pattern, reason in RULES:
        text += (
            "prefix_rule(\n"
            f"    pattern = {json.dumps(pattern)},\n"
            '    decision = "allow",\n'
            f"    justification = {json.dumps(reason)},\n"
            ")\n\n"
        )
    return text


def validate(codex, path):
    # Check every allowed prefix, including both pnpm spellings, using Codex's
    # actual parser and matcher. Negative probes must receive no allow decision.
    allowed = (
        [["pnpm", name] for name in SCRIPTS + ["audit", "outdated"]]
        + [["pnpm", "run", name] for name in SCRIPTS]
        + [["cargo", name] for name in ["check", "test", "clippy", "fmt"]]
        + [["cargo", "deny", "check"], ["pnpm", "verify", "--online"]]
    )
    excluded = [
        ["pnpm", "exec", "node", "-e", "process.exit()"],
        ["pnpm", "publish"], ["cargo", "install", "example"],
        ["bash", "-c", "echo example"], ["python3", "example.py"],
        ["git", "push"], ["rm", "example"],
    ]
    for command, expected in [(c, True) for c in allowed] + [(c, False) for c in excluded]:
        result = subprocess.run(
            [codex, "execpolicy", "check", "--rules", str(path), "--", *command],
            check=True, text=True, capture_output=True,
        )
        decision = json.loads(result.stdout).get("decision")
        if (decision == "allow") != expected:
            raise RuntimeError(f"Unexpected decision {decision!r} for {command!r}")
    print(f"Validated {len(allowed)} allowed and {len(excluded)} excluded commands.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate only; do not install")
    parser.add_argument("--codex", default="codex", help="Codex executable (default: codex on PATH)")
    args = parser.parse_args()
    codex = shutil.which(args.codex)
    if codex is None:
        parser.error("Codex CLI is required to validate the rules; install it first.")
    content = render_rules()
    with tempfile.TemporaryDirectory(prefix="bismillah-codex-rules-") as scratch:
        draft = Path(scratch) / "bismillah.rules"
        draft.write_text(content, encoding="utf-8")
        validate(codex, draft)
    if args.check:
        print("Check only: no project permissions changed.")
        return
    root = Path(__file__).resolve().parent.parent
    directory = root / ".codex" / "rules"
    target = directory / "bismillah.rules"
    for path in [root / ".codex", directory, target]:
        if path.is_symlink():
            raise RuntimeError(f"Refusing to write through a symlink: {path}")
    directory.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.read_text(encoding="utf-8") != content:
            raise RuntimeError(f"Existing rules differ; review them before replacing: {target}")
        print(f"Already installed: {target}")
    else:
        with target.open("x", encoding="utf-8") as file:
            file.write(content)
        print(f"Installed: {target}")
    print("Restart Codex or start a new session in this trusted project to load the rules.")
    print("Global settings are unchanged; commands outside these rules can still prompt.")


if __name__ == "__main__":
    main()
