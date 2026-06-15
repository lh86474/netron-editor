2026-06-12

Tags: [[netron]] [[ambarella]]

## Phase 3 — UI changes

### Toolbar (replace role radio as primary control)

Before:

Model A: backbone.onnx [Browse] Role: ● Upstream

Model B: head.onnx [Browse] ○ Downstream

After:

Model A: backbone.onnx [Browse] ↑ Upstream (auto)

Model B: head.onnx [Browse] ↓ Downstream (auto)

[ Swap roles ]

Rules:

- Labels Upstream / Downstream appear only after both models loaded and detection runs.
- Swap roles toggles `upstreamSlot` A↔B, sets `userOverridden: true`, keeps mapping if still valid under swapped roles (re-validate; clear invalid rows).
- Remove primary upstream/downstream radio buttons; swap is the manual override.
- Source graph panes follow detected roles: upstream pane = upstream model, downstream pane = downstream model.

### Validation summary messages

| Status           | Summary text                                                 |
| ---------------- | ------------------------------------------------------------ |
| `resolved`, high | `✓ Models connected: backbone → head`                        |
| `resolved`, low  | `⚠ Direction auto-detected (review mapping)`                 |
| `ambiguous`      | `✗ Ambiguous direction — use Swap roles or adjust models`    |
| `failed`         | `✗ Models cannot be merged in either direction` + error list |

### In-app entry (model already open)

- Pre-fill slot A with open model.
- Do not assign upstream/downstream until second model loads.
- Run `detectMergeRoles` when slot B loads; slot A is not assumed upstream.