"""Sanitized transcripts of the AC-05 fresh sessions, from the host's subagent JSONL logs.

Usage (from this worktree):
    PYTHONPATH=src python docs/evidence/gc-ai-0015/extract_transcripts.py <agent.jsonl> <label> <out.md>

Keeps, in order: the initial prompt, every tool call (name + command or path), its result
(truncated, with an error flag) and the final report. Credential-looking text is redacted
with the same guards the evidence and the profile use.
"""

import json
import sys
from pathlib import Path

from galecore_ai.contracts.evidence import _CREDENTIAL_IN_TEXT
from galecore_ai.contracts.profile import _CREDENTIAL_ES

LIMIT = 1500


def clean(text: str) -> str:
    text = _CREDENTIAL_IN_TEXT.sub("[REDACTED]", text)
    return _CREDENTIAL_ES.sub("[REDACTED]", text)


def cut(text: str) -> str:
    return text if len(text) <= LIMIT else text[:LIMIT] + f"\n… [recortado: {len(text)} caracteres en total]"


def as_text(content) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")


def main(src: str, label: str, out: str) -> None:
    rows = [json.loads(line) for line in Path(src).read_text(encoding="utf-8").splitlines() if line.strip()]
    parts = [f"# Transcripción saneada — {label}\n",
             (f"Fuente: log del subagente `{Path(src).name}` "
              f"({len(rows)} eventos). Resultados recortados a {LIMIT} caracteres.\n")]
    first_prompt = True
    for row in rows:
        msg = row.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if msg.get("role") == "user" and isinstance(content, str):
            if first_prompt and not content.startswith("<system-reminder>"):
                parts.append("## Pedido inicial (lo único que recibió la sesión)\n\n```text\n" + clean(content) + "\n```\n")
                first_prompt = False
            continue
        if not isinstance(content, list):
            continue
        for block in content:
            kind = block.get("type")
            if kind == "tool_use":
                inp = block.get("input", {})
                what = inp.get("command") or inp.get("file_path") or inp.get("pattern") or json.dumps(inp, ensure_ascii=False)
                if block.get("name") == "SubagentHandback":
                    final = inp.get("report") or inp.get("message") or what
                    parts.append("## Respuesta final entregada\n\n" + clean(str(final)) + "\n")
                    continue
                parts.append(f"### {block.get('name')}\n\n```text\n{clean(str(what))}\n```\n")
            elif kind == "tool_result":
                flag = " (error)" if block.get("is_error") else ""
                parts.append(f"Resultado{flag}:\n\n```text\n{cut(clean(as_text(block.get('content', ''))))}\n```\n")
            elif kind == "text" and msg.get("role") == "assistant" and block.get("text", "").strip():
                parts.append("> " + clean(block["text"]).replace("\n", "\n> ") + "\n")
    text = "\n".join(parts).replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip() for line in text.split("\n")).rstrip("\n") + "\n"
    Path(out).write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(*sys.argv[1:4])
