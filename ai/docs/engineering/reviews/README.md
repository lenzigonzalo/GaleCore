# Independent reviews

One file per Codex review run, written by `/review-codex` (workspace skill in
`../../../../.claude/skills/review-codex/`). Name: `<work-item-id>-<UTC timestamp>.md`.

Each file carries front matter (`work_item`, `reviewer`, `reviewed_at`, `scope`, `effort`) and the
reviewer's verdict, rerun checks, findings by severity, evidence-matrix check and scope notes.

These files are evidence for the independent-review criterion of a work item. They are committed
with the item and never edited by the implementer; resolutions are recorded in the work item's
"Independent review" section, pointing at the file.
