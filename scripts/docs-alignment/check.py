#!/usr/bin/env python3
"""Check that the docs still match the code. Standard library only.

It reads facts from the source (commands, options, agents, import stages, home menu,
frameworks, source file types, log retention, Node version) and checks that the docs
agree. It checks two sets of docs:

  * the Markdown docs in this repo, always;
  * the public Contentful docs (contentful/contentful-docs), when a token or a local
    copy is available.

It also warns when a change touches doc-sensitive code and no doc changed.

By default drift is reported as warnings and the exit code is 0. Use --strict to exit 1.

    python3 scripts/docs-alignment/check.py
    python3 scripts/docs-alignment/check.py --changed-files changed.txt --strict
    python3 scripts/docs-alignment/check.py --public-docs-dir /path/to/import-design-system
    python3 check.py --repo-root /path/to/experience-design-system-sdk-public --public-docs-from-gh
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "packages" / "experience-design-system-cli"
PIPELINE = ROOT / "packages" / "experience-design-system-backend-pipeline"

LOCAL_DOCS = [
    "README.md",
    "AGENTS.md",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "packages/experience-design-system-cli/DSI_TUI_ARCHITECTURE.md",
]

PUBLIC_DOCS_REPO = "contentful/contentful-docs"
PUBLIC_DOCS_PATH = "fern/docs/pages/experience-orchestration/import-design-system"
PUBLIC_DOCS = ["getting-started.mdx", "import-flow.mdx", "command-reference.mdx", "faq.mdx", "overview.mdx"]

NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}

FRAMEWORK_NAMES = {
    "react": "React",
    "vue": "Vue",
    "astro": "Astro",
    "web-component": "Web Component",
    "stencil": "Stencil",
    "svelte": "Svelte",
    "angular": "Angular",
}

# Source paths whose changes usually need a doc update, and the docs to review.
SENSITIVE_PATHS = [
    (r"^packages/experience-design-system-cli/(program\.ts|src/commands/)",
     "the commands and options", ["README.md", "ARCHITECTURE.md", "command-reference.mdx", "getting-started.mdx"]),
    (r"^packages/experience-design-system-cli/src/tui/(import/steps/|shared/components/StepHeader)",
     "the import steps", ["DSI_TUI_ARCHITECTURE.md", "import-flow.mdx", "getting-started.mdx"]),
    (r"^packages/experience-design-system-cli/src/tui/home/",
     "the home screen", ["ARCHITECTURE.md", "command-reference.mdx", "getting-started.mdx"]),
    (r"^packages/experience-design-system-cli/src/tui/settings/",
     "the Settings menu", ["command-reference.mdx", "getting-started.mdx", "faq.mdx"]),
    (r"^packages/experience-design-system-backend-pipeline/src/agents/(types/agent-name|constants/binaries)",
     "the supported coding agents", ["README.md", "faq.mdx", "getting-started.mdx"]),
    (r"^packages/experience-design-system-backend-pipeline/src/(steps/extraction/src/(types/component|framework-adapters/)|persistence/src/constants/file-patterns)",
     "the supported frameworks or file types", ["README.md", "ARCHITECTURE.md", "DSI_TUI_ARCHITECTURE.md", "getting-started.mdx"]),
    (r"(debug-mode-store|debug-store|file-locations)",
     "debug logs and saved files", ["faq.mdx", "getting-started.mdx"]),
    (r"^packages/experience-design-system-cli/package\.json$",
     "the package bin or Node version", ["README.md", "getting-started.mdx"]),
]


@dataclass
class Finding:
    scope: str  # "local" or "public"
    file: str
    line: int
    rule: str
    message: str


@dataclass
class Facts:
    commands: set[str] = field(default_factory=set)
    options: set[str] = field(default_factory=set)
    agents: list[str] = field(default_factory=list)
    agent_labels: dict[str, str] = field(default_factory=dict)
    bins: list[str] = field(default_factory=list)
    stages: list[str] = field(default_factory=list)
    home_items: list[str] = field(default_factory=list)
    retention: list[int] = field(default_factory=list)
    retention_default: int | None = None
    frameworks: list[str] = field(default_factory=list)
    extensions: list[str] = field(default_factory=list)
    node_major: int | None = None


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def block_after(text: str, marker: str, open_char: str, close_char: str) -> str:
    """Return the text of the bracketed block that follows `marker`."""
    start = text.find(marker)
    if start < 0:
        return ""
    equals = text.find("=", start)  # Skip any type annotation, such as `{ label: string }[]`.
    i = text.find(open_char, equals if equals >= 0 else start)
    if i < 0:
        return ""
    depth = 0
    for j in range(i, len(text)):
        if text[j] == open_char:
            depth += 1
        elif text[j] == close_char:
            depth -= 1
            if depth == 0:
                return text[i : j + 1]
    return ""


def extract_facts() -> tuple[Facts, list[str]]:
    facts = Facts()
    problems: list[str] = []

    def need(name: str, ok: bool) -> None:
        if not ok:
            problems.append(f"could not read {name} from the source; update scripts/docs-alignment/check.py")

    # Commands and options registered on the CLI.
    sources = [CLI / "program.ts", *sorted((CLI / "src" / "commands").glob("*.ts"))]
    for src in sources:
        text = read(src)
        facts.commands |= set(re.findall(r"\.command\(\s*'([a-z][a-z-]*)'", text))
        facts.options |= set(re.findall(r"\.option\(\s*'(--[a-z][a-z-]*)", text))
    need("the registered commands", bool(facts.commands))

    agent_types = read(PIPELINE / "src" / "agents" / "types" / "agent-name.ts")
    facts.agents = re.findall(r"'([a-z]+)'", block_after(agent_types, "AGENT_NAMES", "[", "]"))
    need("AGENT_NAMES", bool(facts.agents))

    labels = read(CLI / "src" / "tui" / "settings" / "configuration" / "agents" / "agent-store.ts")
    facts.agent_labels = dict(re.findall(r"^\s+([a-z]+):\s*'([^']+)',?$", block_after(labels, "AGENT_LABELS", "{", "}"), re.M))
    need("AGENT_LABELS", bool(facts.agent_labels))

    pkg = json.loads(read(CLI / "package.json"))
    facts.bins = sorted((pkg.get("bin") or {}).keys())
    match = re.search(r"(\d+)", (pkg.get("engines") or {}).get("node", ""))
    facts.node_major = int(match.group(1)) if match else None
    need("engines.node", facts.node_major is not None)

    step_header = read(CLI / "src" / "tui" / "shared" / "components" / "StepHeader.tsx")
    facts.stages = re.findall(r"label:\s*'([^']+)'", block_after(step_header, "IMPORT_STEPS", "[", "]"))
    need("IMPORT_STEPS", bool(facts.stages))

    home = read(CLI / "src" / "tui" / "home" / "home.tsx")
    facts.home_items = re.findall(r"label:\s*'([^']+)'", block_after(home, "START_ITEMS", "[", "]"))
    need("START_ITEMS", bool(facts.home_items))

    retention = read(CLI / "src" / "tui" / "settings" / "debug-mode" / "debug-mode-store.ts")
    facts.retention = [int(n) for n in re.findall(r"\d+", block_after(retention, "RETENTION_CHOICES", "[", "]"))]
    default = re.search(r"DEFAULT_RETENTION_DAYS[^=]*=\s*(\d+)", retention)
    facts.retention_default = int(default.group(1)) if default else None
    need("the log retention values", bool(facts.retention) and facts.retention_default is not None)

    component = read(PIPELINE / "src" / "steps" / "extraction" / "src" / "types" / "component.ts")
    union = re.search(r"framework:\s*([^;]+);", component)
    keys = re.findall(r"'([a-z-]+)'", union.group(1)) if union else []
    facts.frameworks = [FRAMEWORK_NAMES[k] for k in keys if k in FRAMEWORK_NAMES]
    need("the supported frameworks", bool(facts.frameworks))

    patterns = read(PIPELINE / "src" / "persistence" / "src" / "constants" / "file-patterns.ts")
    facts.extensions = re.findall(r"'(\.[a-z]+)'", block_after(patterns, "INCLUDED_EXTENSIONS", "[", "]"))
    need("INCLUDED_EXTENSIONS", bool(facts.extensions))
    return facts, problems


# --- reading docs ---------------------------------------------------------------


def load_local_docs() -> dict[str, str]:
    docs = {}
    for rel in LOCAL_DOCS:
        path = ROOT / rel
        if path.exists():
            docs[rel] = read(path)
    return docs


def load_public_docs(directory: str | None, from_gh: bool = False) -> tuple[dict[str, str], str]:
    """Return the public docs and a note about where they came from."""
    docs: dict[str, str] = {}
    if directory:
        for name in PUBLIC_DOCS:
            path = Path(directory) / name
            if path.exists():
                docs[name] = read(path)
        return docs, f"local copy at {directory}"
    if from_gh:
        for name in PUBLIC_DOCS:
            result = subprocess.run(
                ["gh", "api", "-H", "Accept: application/vnd.github.raw+json",
                 f"repos/{PUBLIC_DOCS_REPO}/contents/{PUBLIC_DOCS_PATH}/{name}?ref=main"],
                capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                return {}, f"skipped: could not read {name} with the gh CLI ({result.stderr.strip() or 'is gh signed in?'})"
            docs[name] = result.stdout
        return docs, f"{PUBLIC_DOCS_REPO}@main, read with the gh CLI"
    token = os.environ.get("DOCS_REPO_TOKEN", "").strip()
    if not token:
        return docs, "skipped: set DOCS_REPO_TOKEN (read access to contentful/contentful-docs) to check the public docs"
    for name in PUBLIC_DOCS:
        url = f"https://api.github.com/repos/{PUBLIC_DOCS_REPO}/contents/{PUBLIC_DOCS_PATH}/{name}?ref=main"
        request = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.raw+json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                docs[name] = response.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError) as error:
            return {}, f"skipped: could not read {name} from {PUBLIC_DOCS_REPO} ({error})"
    return docs, f"{PUBLIC_DOCS_REPO}@main"


# --- rules ----------------------------------------------------------------------


def code_spans(line: str) -> list[str]:
    return re.findall(r"`([^`]+)`", line)


def doc_lines(text: str):
    """Yield (line number, line, in_code_fence)."""
    fenced = False
    for number, line in enumerate(text.split("\n"), start=1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        yield number, line, fenced


def rule_commands_and_flags(scope: str, name: str, text: str, facts: Facts) -> list[Finding]:
    """Docs must not show a command or flag the CLI does not have."""
    findings: list[Finding] = []
    known_flags = facts.options | {"--version", "--help", "--watch"}  # Commander adds --help to the root command.
    for number, line, fenced in doc_lines(text):
        pieces = [line] if fenced else code_spans(line)
        mentions_cli = False
        for piece in pieces:
            for word in re.findall(r"(?:^|\s)(?:experiences|exo)\s+([a-z][a-z-]*)\b", piece.strip()):
                mentions_cli = True
                if word not in facts.commands:
                    findings.append(Finding(scope, name, number, "unknown-command",
                                            f"`experiences {word}` is not a command. The CLI registers: {', '.join(sorted(facts.commands))}."))
            if re.match(r"^(experiences|exo)\b", piece.strip()):
                mentions_cli = True
        if not mentions_cli:
            continue
        for piece in pieces:
            for flag in re.findall(r"(?:^|\s)(--[a-z][a-z-]*)", piece):
                if flag not in known_flags:
                    findings.append(Finding(scope, name, number, "unknown-flag",
                                            f"`{flag}` is not an option of the CLI. It registers: {', '.join(sorted(facts.options)) or 'none'}."))
    return findings


def rule_agent_count(scope: str, name: str, text: str, facts: Facts) -> list[Finding]:
    findings = []
    expected = len(facts.agents)
    for number, line, _ in doc_lines(text):
        for match in re.finditer(r"\b(one|two|three|four|five|six|seven|eight|\d+)\s+(?:supported\s+)?(?:coding\s+)?agents\b", line, re.I):
            word = match.group(1).lower()
            count = NUMBER_WORDS.get(word, int(word) if word.isdigit() else None)
            if count is not None and count != expected:
                findings.append(Finding(scope, name, number, "agent-count",
                                        f"says {match.group(1)} agents, but the CLI supports {expected}: {', '.join(facts.agents)}."))
    return findings


def contains_all(line: str, items: list[str], loose: bool = False) -> list[str]:
    haystack = line.lower()
    return [i for i in items if i.lower() not in haystack] if not loose else [i for i in items if i.lower().rstrip("s") not in haystack]


def find_line(text: str, pattern: str) -> tuple[int, str] | None:
    for number, line in enumerate(text.split("\n"), start=1):
        if re.search(pattern, line):
            return number, line
    return None


def must_list(scope, name, text, pattern, items, rule, what, loose=False, window=0) -> list[Finding]:
    hit = find_line(text, pattern)
    if hit is None:
        return []  # The anchor is gone; nothing to compare.
    number, line = hit
    if window:  # The list may continue on the following lines, for example as bullets.
        line = "\n".join(text.split("\n")[number - 1 : number + window])
    missing = contains_all(line, items, loose)
    if not missing:
        return []
    return [Finding(scope, name, number, rule, f"{what} is missing: {', '.join(missing)}.")]


def must_contain(scope, name, text, phrases, rule, what) -> list[Finding]:
    findings = []
    for phrase in phrases:
        if phrase.lower() not in text.lower():
            findings.append(Finding(scope, name, 1, rule, f"{what}: expected to mention '{phrase}'."))
    return findings


def check_local(docs: dict[str, str], facts: Facts) -> list[Finding]:
    findings: list[Finding] = []
    for name, text in docs.items():
        findings += rule_commands_and_flags("local", name, text, facts)
        findings += rule_agent_count("local", name, text, facts)

    readme = docs.get("README.md", "")
    findings += must_list("local", "README.md", readme, r"source files \(`", [f"`{e}`" for e in facts.extensions],
                          "source-extensions", "The list of source file types")
    findings += must_contain("local", "README.md", readme, [f"Node.js {facts.node_major}"], "node-version", "The prerequisites")
    findings += must_contain("local", "README.md", readme, facts.bins, "binaries", "The install note")

    arch = docs.get("ARCHITECTURE.md", "")
    findings += must_list("local", "ARCHITECTURE.md", arch, r"^\s*\(.*React.*\)\s*$", facts.frameworks, "frameworks",
                          "The framework list in the system diagram", loose=True)
    findings += must_list("local", "ARCHITECTURE.md", arch, r"Ink TUI:", facts.home_items, "home-menu", "The home screen menu")

    agents_md = docs.get("AGENTS.md", "")
    findings += must_list("local", "AGENTS.md", agents_md, r"extracts .*definitions from customer codebases", facts.frameworks,
                          "frameworks", "The list of frameworks the CLI extracts", loose=True)

    tui_name = "packages/experience-design-system-cli/DSI_TUI_ARCHITECTURE.md"
    tui = docs.get(tui_name, "")
    findings += must_list("local", tui_name, tui, r"`StepHeader`", facts.stages, "stage-labels", "The StepHeader tab bar")
    section = re.search(r"## Supported Frameworks\n(.*?)(?=\n## |\n---|\Z)", tui, re.S)
    if section:
        missing = contains_all(section.group(1), facts.frameworks, loose=True)
        if missing:
            line = tui[: section.start()].count("\n") + 1
            findings.append(Finding("local", tui_name, line, "frameworks", f"The supported frameworks list is missing: {', '.join(missing)}."))
    unsupported = re.search(r"## Unsupported Frameworks\n(.*?)(?=\n## |\n---|\Z)", tui, re.S)
    if unsupported:
        listed = [f for f in facts.frameworks if f.lower() in unsupported.group(1).lower()]
        if listed:
            line = tui[: unsupported.start()].count("\n") + 1
            findings.append(Finding("local", tui_name, line, "frameworks", f"Lists as unsupported, but the CLI supports: {', '.join(listed)}."))
    return findings


def check_public(docs: dict[str, str], facts: Facts) -> list[Finding]:
    findings: list[Finding] = []
    for name, text in docs.items():
        findings += rule_commands_and_flags("public", name, text, facts)
        findings += rule_agent_count("public", name, text, facts)
    labels = [facts.agent_labels.get(a, a) for a in facts.agents]
    loose_labels = [l.replace("OpenAI ", "") for l in labels]  # The public docs say "Codex", the CLI says "OpenAI Codex".

    if "import-flow.mdx" in docs:
        # The stage names must appear together, in the order the CLI shows them. The words alone appear all over the page.
        sequence = r"\W+(?:and\W+)?".join(re.escape(stage) for stage in facts.stages)
        if not re.search(sequence, docs["import-flow.mdx"]):
            findings.append(Finding("public", "import-flow.mdx", 1, "stage-labels",
                                    f"The import stages: expected '{', '.join(facts.stages)}' in this order, as the CLI shows them."))
    if "faq.mdx" in docs:
        faq = docs["faq.mdx"]
        findings += must_contain("public", "faq.mdx", faq, loose_labels, "agents", "The supported agents")
        retention = ", ".join(str(n) for n in facts.retention[:-1]) + f", or {facts.retention[-1]}"
        findings += must_contain("public", "faq.mdx", faq, [retention, f"default is {facts.retention_default}"], "log-retention", "The debug log answer")
    if "getting-started.mdx" in docs:
        start = docs["getting-started.mdx"]
        findings += must_contain("public", "getting-started.mdx", start, loose_labels, "agents", "The coding agent table")
        if not any(p.lower() in start.lower() for p in (f"Node.js {facts.node_major}", f"Node.js v{facts.node_major}", f"v{facts.node_major}")):
            findings.append(Finding("public", "getting-started.mdx", 1, "node-version",
                                    f"The Node.js requirement: expected to mention Node.js {facts.node_major}."))
        findings += must_list("public", "getting-started.mdx", start, r"reads components from", facts.frameworks, "frameworks",
                              "The supported frameworks", loose=True, window=12)
        findings += must_contain("public", "getting-started.mdx", start, [f"`{e}`" for e in facts.extensions], "source-extensions", "The supported file types")
    if "command-reference.mdx" in docs:
        findings += must_contain("public", "command-reference.mdx", docs["command-reference.mdx"], [f"**{i}**" for i in facts.home_items],
                                 "home-menu", "The home screen options")
    return findings


def check_changed_files(changed: list[str]) -> list[Finding]:
    """Warn when doc-sensitive code changed and no doc did."""
    docs_changed = any(f.endswith((".md", ".mdx")) for f in changed)
    findings: list[Finding] = []
    if docs_changed:
        return findings
    for pattern, what, docs in SENSITIVE_PATHS:
        hits = [f for f in changed if re.search(pattern, f)]
        if hits:
            findings.append(Finding("diff", hits[0], 1, "docs-not-updated",
                                    f"This PR changes {what} ({len(hits)} file{'s' if len(hits) != 1 else ''}) but no docs. Review: {', '.join(docs)}."))
    return findings


# --- output ---------------------------------------------------------------------


def annotate(finding: Finding, level: str) -> str:
    if finding.scope == "public":
        file = f"{PUBLIC_DOCS_REPO}:{finding.file}"
        return f"::{level} title=Public docs out of date ({finding.rule})::{file}: {finding.message}"
    return f"::{level} file={finding.file},line={finding.line},title=Docs out of date ({finding.rule})::{finding.message}"


def summary_markdown(findings: list[Finding], notes: list[str], facts: Facts) -> str:
    lines = ["## Docs alignment", ""]
    if not findings:
        lines.append("No drift found between the docs and the code.")
    else:
        lines += [f"Found **{len(findings)}** place(s) where the docs and the code disagree.", "",
                  "| Where | Rule | What is wrong |", "| --- | --- | --- |"]
        for f in findings:
            where = f"`{f.file}`" + (f":{f.line}" if f.scope == "local" else " (public docs)")
            lines.append(f"| {where} | {f.rule} | {f.message} |")
    lines += ["", "<details><summary>Facts read from the code</summary>", "",
              f"- Commands: {', '.join(sorted(facts.commands))}",
              f"- Options on `import`: {', '.join(sorted(facts.options))}",
              f"- Agents: {', '.join(facts.agents)}",
              f"- Import stages: {', '.join(facts.stages)}",
              f"- Home menu: {', '.join(facts.home_items)}",
              f"- Frameworks: {', '.join(facts.frameworks)}",
              f"- Source file types: {', '.join(facts.extensions)}",
              f"- Log retention (days): {', '.join(map(str, facts.retention))}, default {facts.retention_default}",
              f"- Node.js: {facts.node_major} or later", "", "</details>"]
    if notes:
        lines += [""] + [f"_{n}_" for n in notes]
    lines += ["", "How to fix: see `.claude/skills/docs-alignment/SKILL.md`."]
    return "\n".join(lines) + "\n"


def main() -> int:
    global ROOT, CLI, PIPELINE
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo-root", help="the SDK repo to check (default: the repo this script is in)")
    parser.add_argument("--public-docs-from-gh", action="store_true",
                        help="read the public docs with the gh CLI, using your own sign-in")
    parser.add_argument("--changed-files", help="a file with the changed paths, one per line")
    parser.add_argument("--public-docs-dir", help="a local copy of the public docs folder (otherwise read via DOCS_REPO_TOKEN)")
    parser.add_argument("--strict", action="store_true", help="exit 1 when any drift is found")
    parser.add_argument("--json", action="store_true", help="print findings as JSON")
    args = parser.parse_args()

    if args.repo_root:
        ROOT = Path(args.repo_root).resolve()
        CLI = ROOT / "packages" / "experience-design-system-cli"
        PIPELINE = ROOT / "packages" / "experience-design-system-backend-pipeline"
    if not CLI.is_dir() or not PIPELINE.is_dir():
        print(f"error: {ROOT} does not look like the experience-design-system-sdk-public repo", file=sys.stderr)
        return 2

    facts, problems = extract_facts()
    if problems:
        for problem in problems:
            print(f"error: {problem}", file=sys.stderr)
        return 2

    findings = check_local(load_local_docs(), facts)
    notes: list[str] = []
    public_docs, source = load_public_docs(args.public_docs_dir, args.public_docs_from_gh)
    notes.append(f"Public docs: {source}.")
    if public_docs:
        findings += check_public(public_docs, facts)
    if args.changed_files:
        changed = [l.strip() for l in read(Path(args.changed_files)).splitlines() if l.strip()]
        findings += check_changed_files(changed)

    level = "error" if args.strict else "warning"
    in_ci = os.environ.get("GITHUB_ACTIONS") == "true"
    if args.json:
        print(json.dumps([f.__dict__ for f in findings], indent=2))
    else:
        for f in findings:
            print(annotate(f, level) if in_ci else f"[{f.scope}] {f.file}:{f.line} ({f.rule}) {f.message}")
        for note in notes:
            print(f"note: {note}")
        print(f"\n{len(findings)} finding(s).")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(summary_markdown(findings, notes, facts))
    return 1 if (findings and args.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
