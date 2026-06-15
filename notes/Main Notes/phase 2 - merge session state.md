2026-06-12

Tags: [[netron]] [[ambarella]]
## Phase 2 — Merge session state

Replace the manual-role-first model with slot-based storage + derived roles.

### Before (current plan)

{

upstream: { model, proto, target, filename } | null,

downstream: { model, proto, target, filename } | null,

mapping: [...],

}

### After

{

slotA: { model, proto, target, filename } | null,

slotB: { model, proto, target, filename } | null,

roleDetection: {

status: 'pending' | 'resolved' | 'ambiguous' | 'failed',

upstreamSlot: 'A' | 'B' | null,

confidence: 'high' | 'low' | null,

userOverridden: boolean,

lastDetectedAt: number,

errors: MergeIssue[],

warnings: MergeIssue[],

},

// Derived accessors (computed, not stored independently):

// upstream = roleDetection.upstreamSlot === 'A' ? slotA : slotB

// downstream = opposite

mapping: Array<{ upstream, downstream }>,

mappingSource: 'auto' | 'manual' | 'empty',

showSourceGraphs: boolean,

mergedPreview: { ... } | null,

validation: { ok, errors, warnings },

}

### When to run detection

Trigger `_resolveMergeRoles()` when:

- Both slots have loaded protos
- Either slot's model is replaced (clear `userOverridden`)
- User clicks Swap roles (manual override — skip re-detection until models change)

Debounce ~100ms (cheap; no need for 400ms preview debounce).

### Detection → mapping flow

| Detection result                | Role UI                                                         | Mapping behavior                                    |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `resolved` + `confidence: high` | Show labels: "Upstream" / "Downstream"                          | Pre-fill mapping from detection; user can edit rows |
| `resolved` + `confidence: low`  | Same + subtle "Auto-detected" badge                             | Pre-fill mapping, show summary warning              |
| `ambiguous`                     | Show Swap roles + "Could not determine direction automatically" | Empty mapping; user must swap to pick direction     |
| `failed`                        | Show errors from both attempts                                  | Empty mapping; block preview                        |
| Only one slot loaded            | "Waiting for second model…"                                     | No mapping rows yet                                 |

Policy change from original plan: v1 had "explicit mapping only, no auto-match." With auto role detection, pre-filling mapping when detection succeeds is the natural companion — but rows remain editable. Keep manual override as the escape hatch.