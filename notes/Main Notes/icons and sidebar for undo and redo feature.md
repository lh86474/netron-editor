2026-06-16

Tags: [[netron]] [[ambarella]]
## icons and sidebar for undo and redo feature

### Notes

Today undo/redo only exist in the **Edit menu** (when the app menu bar is enabled) and as **keyboard shortcuts**. There are no always-visible buttons yet.

## What exists today

Undo/redo are wired in `view.js` under the Edit menu:

```188:200:source/view.js
                const edit = this._menu.group('&Edit');
                edit.add({
                    label: '&Undo',
                    accelerator: 'CmdOrCtrl+Z',
                    execute: async () => await this._undoEdit(),
                    enabled: () => this._canUndoEdit()
                });
                edit.add({
                    label: '&Redo',
                    accelerator: platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y',
                    execute: async () => await this._redoEdit(),
                    enabled: () => this._canRedoEdit()
                });
```

The handlers and enable checks are already there:

- `_undoEdit()` / `_redoEdit()`
- `_canUndoEdit()` / `_canRedoEdit()` (requires edit session + ONNX-exportable model + non-empty history stack)

Shortcut display in the menu reuses `Menu.register()`, which formats accelerators into the `menu-shortcut` span (⌘Z on macOS, `Ctrl+Z` on Windows/Linux).

## Toolbar vs sidebar in this codebase

These are different UI surfaces:

| Surface                                  | Element    | Current controls                                 |
| ---------------------------------------- | ---------- | ------------------------------------------------ |
| **Toolbar** (bottom bar)                 | `#toolbar` | Zoom, sync scroll, model/target property buttons |
| **Properties sidebar** (right slide-out) | `#sidebar` | Node/tensor/model property panels                |

Buttons named `sidebar-model-button` and `sidebar-target-button` live on the **toolbar**, not inside `#sidebar`.

For always-visible undo/redo, the **toolbar** is the natural fit (same pattern as zoom/sync). The properties sidebar is usually tied to a selected node and closes often — less ideal for global edit actions unless you add a fixed editor section.

## Recommended approach: toolbar buttons with visible shortcuts

### 1. HTML (`index.html`)

Add two buttons in `#toolbar`, e.g. after `sync-scroll-button`:

```html
<button id="undo-button" class="toolbar-button toolbar-edit-button" type="button">
    <span class="toolbar-edit-label">Undo</span>
    <span id="undo-shortcut" class="toolbar-edit-shortcut"></span>
</button>
<button id="redo-button" class="toolbar-button toolbar-edit-button" type="button">
    <span class="toolbar-edit-label">Redo</span>
    <span id="redo-shortcut" class="toolbar-edit-shortcut"></span>
</button>
```

CSS idea (mirroring `menu-shortcut`):

```css
.toolbar-edit-button { width: auto; min-width: 4.5em; padding: 0 8px; flex-direction: column; }
.toolbar-edit-label { font-size: 11px; }
.toolbar-edit-shortcut { font-size: 10px; color: #888; }
.toolbar-edit-button:disabled { opacity: 0.4; cursor: default; }
```

### 2. Wire in `view.View.start()` (`view.js`)

After the other toolbar listeners (~lines 64–79):

```javascript
// Format shortcuts (reuse same accelerators as menu)
const undoAccel = 'CmdOrCtrl+Z';
const redoAccel = platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y';
this._element('undo-shortcut').innerHTML = this._menu.register({ execute: () => {} }, undoAccel);
this._element('redo-shortcut').innerHTML = this._menu.register({ execute: () => {} }, redoAccel);

this._element('undo-button').addEventListener('click', () => this._undoEdit());
this._element('redo-button').addEventListener('click', () => this._redoEdit());
```

**Note:** `register()` also binds accelerators, so calling it again would duplicate Ctrl+Z. Better options:

- Add `Menu.formatAccelerator(accelerator)` (extract formatting from `register()` without binding), or
- Store references when creating menu items and read `.shortcut` from them (would require `edit.add()` to return the command item).

### 3. Enable/disable updates

Add something like `_updateUndoRedoButtons()`:

```javascript
_updateUndoRedoButtons() {
    const undo = this._element('undo-button');
    const redo = this._element('redo-button');
    if (!undo || !redo) return;
    undo.disabled = !this._canUndoEdit();
    redo.disabled = !this._canRedoEdit();
}
```

Call it from:

- `_bindEditorSession()` (model open/close)
- End of `_undoEdit()` / `_redoEdit()`
- End of `applyEditorPatch()` (history changes)
- Optionally after `_extractAndReplaceGraph()`

Pattern matches `_updateSyncScrollButton()` at line 589.


