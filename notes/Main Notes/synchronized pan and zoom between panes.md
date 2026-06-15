2026-06-08

Tags: [[ambarella]] [[netron]]
## synchronized pan and zoom between panes

### Notes

## Research findings

Netron’s pan/zoom is not an SVG `transform` on this path:

| Action                                | Where it happens                                    | State stored                                  |
| ------------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| Pan (drag, scrollbar, wheel-scroll)   | `view.Graph._pointerDownHandler` / container scroll | `container.scrollLeft`, `container.scrollTop` |
| Zoom (wheel+modifier, toolbar, pinch) | `view.Graph._updateZoom`                            | `graph._zoom` + canvas CSS `width`/`height`   |

Scroll events are handled in `_scrollHandler`; zoom changes go through `_updateZoom`.

---

## What we built

### 1. UI — [`source/index.html`](vscode-file://vscode-app/c:/Users/c-lhe/AppData/Local/Programs/cursor/resources/app/out/vs/code/electron-sandbox/workbench/source/index.html)

- Sync Scroll toolbar button (`#sync-scroll-button`) after zoom out
- Two-pane + bidirectional-arrow icon
- `.toolbar-button.active` styles for light and dark themes
- Off by default (`aria-pressed="false"`)

### 2. Option & toggle — [`source/view.js`](vscode-file://vscode-app/c:/Users/c-lhe/AppData/Local/Programs/cursor/resources/app/out/vs/code/electron-sandbox/workbench/source/view.js)

- `syncScroll: false` in `_defaultOptions` (persisted like other view options)
- `toggle('syncScroll')` flips the option, updates button state, and on enable immediately aligns the partner from the active pane
- No full graph reload when toggling

### 3. Sync coordinator — `view.View`

- `_updateSyncScrollButton()` — toggles `active` class and `aria-pressed`
- `_syncEnabled()` — sync on, both pane graphs installed, not mid-sync
- `_propagateSync(sourceGraph)` — copies zoom + scroll from source pane to partner
	- this is the meat of the logic here!

### 4. Event hooks — `view.Graph`

- `_scrollHandler` — after existing logic, propagates pan when sync is enabled
- `_updateZoom` — after zoom is applied, propagates zoom (and resulting scroll)

---

## Loop prevention (3 layers)

1. Source identity guard — only sync from installed `_leftPane.graph` or `_rightPane.graph` (avoids syncing transient graphs during `refresh()`)
2. Re-entrancy flag — `_syncApplying` with `try/finally` while writing to the partner
3. Idempotency — skip writes when partner already matches (`zoom`, `scrollLeft`, `scrollTop`)

That stops A → B → A infinite loops when programmatic scroll fires async echo events on the partner.

---

## How to use

1. Open a model in the dual-pane editor
2. Click Sync Scroll in the bottom-left toolbar (highlights when on)
3. Pan or zoom either pane — the other follows
4. Click again to turn sync off

---

## Files changed

| File                                                                                                                                                                | Changes                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`source/index.html`](vscode-file://vscode-app/c:/Users/c-lhe/AppData/Local/Programs/cursor/resources/app/out/vs/code/electron-sandbox/workbench/source/index.html) | Button + active-state CSS (~18 lines)                      |
| [`source/view.js`](vscode-file://vscode-app/c:/Users/c-lhe/AppData/Local/Programs/cursor/resources/app/out/vs/code/electron-sandbox/workbench/source/view.js)       | Option, toggle, coordinator, scroll/zoom hooks (~81 lines) |

### References