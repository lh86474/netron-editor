2026-06-12

Tags:  [[netron]] [[ambarella]]

## Phase 4 — `view.js` integration

New/changed handlers:

_resolveMergeRoles() // calls detectMergeRoles, updates session

_onMergeModelLoaded(slot) // load into slotA/slotB, then _resolveMergeRoles()

_onMergeSwapRoles() // toggle upstreamSlot, userOverridden=true

_getMergeUpstream() // derived from session

_getMergeDownstream() // derived from session

_refreshMergeMappingTable() // rows from downstream inputs; pre-fill if mappingSource='auto'

_refreshMergePreview() // unchanged; still debounced after valid mapping

_renderMergeSourcePanes() // upstream/downstream from detection, not manual slots

Remove or demote:

- `_onMergeRoleChanged(modelSlot, role)` → replaced by `_onMergeSwapRoles()` + auto detection

Update `_startMergeWorkspace({ presetModel })` — drop `presetRole`; role comes from detection.

---

## Edge cases

| Scenario                                                       | Behavior                                                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer + consumer, wrong slot order                          | Auto-detect correct direction (already tested)                                                                                                 |
| Both directions valid, same score                              | `ambiguous` → user swaps                                                                                                                       |
| Only A→B valid                                                 | Auto: A upstream, status `unidirectional`                                                                                                      |
| Neither direction valid                                        | `failed`, show combined errors                                                                                                                 |
| Symmetric models (same IO shapes, multiple compatible outputs) | Likely `AMBIGUOUS_AUTO_MAPPING` in one or both directions → `failed` or `ambiguous`; user must narrow mapping manually after picking direction |
| User swaps then replaces a model                               | Clear `userOverridden`, re-detect                                                                                                              |
| User swaps then toggles source graphs                          | Panes follow swapped roles                                                                                                                     |
| One model has 0 outputs or 0 inputs                            | That direction fails; other may succeed                                                                                                        |

---

## Testing

### Unit tests (`test/model_merge.test.js`)

Add `describe('detectMergeRoles')`:

| Test                              | Expect                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `correct_order_producer_consumer` | B loaded as A, producer as B → B upstream              |
| `only_forward_valid`              | status `unidirectional`, correct slot                  |
| `ambiguous_both_directions`       | status `ambiguous`, no mapping                         |
| `neither_valid`                   | status `failed`, errors from both                      |
| `tie_breaker_exact_names`         | prefers direction with more exact name matches         |
| `tie_breaker_io_counts`           | prefers more-outputs model as upstream when scores tie |
| `returns_upstreamSlot`            | slot ID matches proto assignment                       |

Existing `buildAutomaticMappingBidirectional` test stays; `detectMergeRoles` wraps it.

### Manual UI tests (update plan §11.2)

| Scenario                | Expected                                  |
| ----------------------- | ----------------------------------------- |
| Load backbone then head | Roles auto-assigned; mapping pre-filled   |
| Load in reverse order   | Same final roles regardless of load order |
| Ambiguous pair          | Swap roles enables mapping                |
| Swap after auto-detect  | Roles flip; mapping re-validated          |
| Replace one model       | Re-detection runs; override cleared       |