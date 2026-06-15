2026-06-08

Tags: [[ambarella]] [[netron]]
## phase 1-3 split-screen, editor

### Notes
### Phase 1: The Brains (State Management)

- **The Photocopy Works:** The system successfully makes a deep, editable clone of the original ONNX graph (`ModelModified`).
    
- **The Notepad Works:** The `DeltaTracker` is actively recording exactly what gets changed, added, or deleted (`EditorState.applyPatch`).
    
- **Bulletproof Testing:** You wrote 20 automated tests to prove the data layer works perfectly, and all 20 are passing. The clone handles Netron's weird internal data types (like `BigInt` numbers and hidden visibility settings) without crashing.
    

### Phase 2: The Split Screen (Dual-Pane UI)

- **Two Independent Screens:** The UI is successfully split down the middle. The left side holds the "Blueprint" (Original), and the right side holds the "Photocopy" (Modified).
    
- **The Left Side is Safe:** The left pane is successfully locked down. If you click on it, the system blocks the sidebar from opening, so you can't accidentally edit the original blueprint.
    
- **No Visual Glitches:** You solved a major browser headache where having two identical graphs on the same screen causes their graphics to overlap or glitch (by ensuring every SVG element has a unique ID, like `original-arrowhead` vs `modified-arrowhead`).
    

### Phase 3: The Editing Tools (Sidebar)

- **Working Text Boxes:** The static sidebar on the right screen was successfully replaced with editable inputs. You can now rename nodes, edit their properties, or click an "Add Attribute" button.
    
- **Smart Validation:** The sidebar is smart enough to look at the ONNX schema. If a property is supposed to be a number, it will treat it like a number, not just text.
    
- **Smooth Updates:** This is a major win mentioned in the report. When you hit Enter to save a change in the sidebar, the graph updates that specific node _instantly_ and smoothly. It doesn't force the entire screen to flash white or show a loading spinner.
    

## Bugs You Squashed

The report notes a few tricky bugs that were caught and fixed along the way:

1. **The Loading Spinner Bug:** Initially, making an edit caused Netron's loading screen logo to get stuck over the UI. That was fixed.
    
2. **Missing Properties:** At first, newly added attributes weren't showing up on the graph. You fixed the wiring so the graph immediately draws the new data.
    
3. **Data Crashes:** Netron struggled to save massive numbers (`BigInt`), which caused crashes. You added a safety net to convert them into standard numbers/strings during editing.
    
