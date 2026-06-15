2026-06-12

Tags: [[ambarella]] [[netron]]
## phase 1 API detectMergeRoles

### Notes
There is a dedicated entry point in **model-merge.js**

1. Call buildAutomaticMappingBidirectional(protoA, protoB)
2. Map rseult so slot IDs by comparing returned protos to protoA and protoB
	1. resolved: one valid direction
	2. ambiguous: both direction valid with tied score 
	3. unidirectional: only one direction works
	4. failed: neither direction works
### Scoring 

# How merge role scoring works

Scoring only runs **after** a direction has already produced a **complete, unambiguous automatic mapping**. It does not guess connections from graph topology alone — it picks the better of two valid “A feeds B” vs “B feeds A” orderings.

## Step 1: Build a mapping per direction (gate)

For each ordering, `buildAutomaticMapping` tries to connect **every downstream `graph.input`** to exactly one **upstream `graph.output`**:

1. For each downstream input, find upstream outputs with compatible types.
2. Pick one via `chooseAutomaticCandidate`:
   - Prefer a **single exact name match** (`output.name === input.name`)
   - Else accept if **only one** compatible output exists
   - Fail with `AMBIGUOUS_AUTO_MAPPING` if multiple outputs fit
3. Require **all** downstream inputs mapped — any failure → that direction is invalid.

Only directions with `ok: true` become **candidates** for scoring.

```
A → B valid?   B → A valid?
     │              │
     └──────┬───────┘
            ▼
     Score each valid candidate
```

---

## Step 2: Compute metrics per candidate

`scoreMappingCandidate` runs on each valid direction and returns:

```406:429:source/model-merge.js
const scoreMappingCandidate = (result, upstreamGraph) => {
    // ...
    return {
        score,
        exactNameMatches,
        warningCount: result.warnings.length,
        ioFit: outputCount - inputCount,
        mappingCount: result.mapping.length
    };
};
```

### `score` (primary)

Per mapping row `{ upstream, downstream }`:

| Connection                            | Points |
| ------------------------------------- | ------ |
| Same name (`hidden → hidden`)         | **+2** |
| Different names (`hidden → features`) | **+1** |

Then subtract **1 per warning** (e.g. partial/missing shapes).

**Example:** one exact match, no warnings → `score = 2`  
Two renamed connections, one warning → `score = 1 + 1 - 1 = 1`

### `exactNameMatches`

Count of rows where `upstream === downstream`. Used as the **second** tie-breaker (not folded into score alone, so two directions with the same total score can still differ here).

### `warningCount`

Number of warnings from mapping (mainly `PARTIAL_SHAPE`). Lower is better on tie-break #3.

### `ioFit`

For the **upstream** model in that candidate:

```
ioFit = outputCount - inputCount
```

Higher means a more “producer-like” boundary (many outputs, few external inputs). Used as tie-break #4.

**Example:** backbone with 1 input / 3 outputs → `ioFit = 2`  
Head with 1 input / 1 output → `ioFit = 0`

---

## Step 3: Compare candidates (lexicographic)

`compareMappingCandidates` picks the winner by checking metrics **in order**; it stops at the first difference:

```432:446:source/model-merge.js
const compareMappingCandidates = (left, right) => {
    if (right.metrics.score !== left.metrics.score) { ... }
    if (right.metrics.exactNameMatches !== left.metrics.exactNameMatches) { ... }
    if (left.metrics.warningCount !== right.metrics.warningCount) { ... }
    if (right.metrics.ioFit !== left.metrics.ioFit) { ... }
    return 0;  // still tied
};
```

Priority:

1. **Higher `score`**
2. **More exact name matches**
3. **Fewer warnings**
4. **Higher `ioFit`**
5. **Tie** → depends on API (see below)

---

## Step 4: Two APIs, different tie behavior

### `buildAutomaticMappingBidirectional`

If both directions are valid but **still tied** after all 4 metrics → **`AMBIGUOUS_MERGE_ROLE`** (no guess).

### `detectMergeRoles`

Same comparison, plus a **5th tie-breaker**: prefer **slot A** as upstream (`compareMappingCandidatesWithSlot`). That turns “perfectly symmetric” pairs into a resolved role with **`confidence: 'low'`** instead of blocking.

---

## Step 5: Confidence

After a winner is chosen:

```469:478:source/model-merge.js
const computeRoleConfidence = (chosen, runnerUp, status) => {
    if (status === 'unidirectional' || !runnerUp) {
        return 'high';
    }
    const scoreGap = chosen.metrics.score - runnerUp.metrics.score;
    const exactGap = chosen.metrics.exactNameMatches - runnerUp.metrics.exactNameMatches;
    if (scoreGap >= 2 || exactGap >= 1) {
        return 'high';
    }
    return 'low';
};
```

| Situation                                                  | Confidence                      |
| ---------------------------------------------------------- | ------------------------------- |
| Only one direction works (`unidirectional`)                | **high**                        |
| Both work, winner ahead by ≥2 score points                 | **high**                        |
| Both work, winner has ≥1 more exact name match             | **high**                        |
| Both work, narrow win (e.g. score gap 1, same exact names) | **low**                         |
| Resolved only via slot-A tie-break                         | **low** (typically score gap 0) |

---

## Worked examples

### Producer → consumer (clear win)

- **Producer:** `x` → `hidden [1,768]`
- **Consumer:** `features [1,768]` → `y`

Only **producer → consumer** can map (`hidden → features`, score 1). Consumer → producer fails (no output matches consumer’s input type/shape).  
→ **`unidirectional`**, **`confidence: high`**

### Exact name beats renamed connection

- **A outputs:** `features`, `hidden` (both compatible)
- **B input:** `features`

A → B maps `features → features` (exact, score 2).  
→ Wins over any direction that only has renamed matches.

### Circular models (score tied)

- **A:** `a → b`
- **B:** `b → a`

Both directions map `b → b` or `a → a` (score 2, same exact matches, same ioFit).

- `buildAutomaticMappingBidirectional` → **ambiguous**
- `detectMergeRoles` → **A upstream**, **`confidence: low`**

### IO fit breaks a tie

- **A:** 2 outputs, 1 input (`ioFit = 1`)
- **B:** 1 output, 1 input (`ioFit = 0`)

Both directions can map one exact connection with score 2.  
→ **A upstream** wins on `ioFit`.

---
## What scoring does *not* do

- It does **not** inspect internal node topology or execution order.
- It does **not** score invalid directions (type mismatch, unmapped inputs, ambiguous per-input choices).
- It does **not** auto-pick when `buildAutomaticMapping` fails for both orderings — that’s **`status: 'failed'`**.

Scoring answers: *“Given two models that could chain either way, which direction is the better boundary connection?”* — using name alignment, mapping quality, warnings, and a light producer/consumption heuristic.