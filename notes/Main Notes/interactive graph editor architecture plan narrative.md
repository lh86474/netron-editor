2026-06-08

Tags: [[ambarella]] [[netron]]
## interactive graph editor architecture plan narrative

### Notes
### Phase 1: The "Photocopy and the Notepad" (State Management)

Right now, Netron reads a file and locks it down. It cannot be edited. If we just let the AI try to shove edits into Netron's locked data, the whole app will crash.

So, before we touch the screen or the UI, we build the "brains."

- **The Photocopy (`EditableModel`):** We create a system that takes a deep copy of the original graph so we have a safe "draft" to play with.
    
- **The Notepad (`DeltaTracker`):** We build a ledger that writes down exactly what changed. If you add a property, the notepad writes: _"Node 5, Property added: Color = Red."_
    

**Why we test this first:** We force Cursor to write a test script that just manipulates data in the background to prove the Photocopy and the Notepad work _perfectly_ before we even think about drawing it on the screen.

### Phase 2: The "Split Screen" (UI Layout)

Once the brains work, we tackle the screen. Netron is hardcoded to only have one screen (one canvas, one set of zoom controls).

In this phase, we rip out that assumption. We split the window in half.

- **Left Side:** Gets the original blueprint. We lock it down so you can't click or edit it.
    
- **Right Side:** Gets the "Photocopy" we made in Phase 1.
    

We have to be careful here because if the AI isn't guided, moving the mouse on the left side might accidentally zoom the right side, or they might overwrite each other's graphics.

### Phase 3: The "Editing Tools" (Sidebar)

Now we have two screens, but no way to actually change anything.

In this phase, we go into Netron's sidebar (the menu that pops up when you click a node) and upgrade it. We change the static text into editable text boxes and add "Add Property" buttons.

When you type a new property into the sidebar on the right screen and hit enter, it sends a message to the "Notepad" from Phase 1 to record the change.

### Phase 4: The "Highlighter" (Visual Feedback)

Finally, we want the right screen to actually look different.

The right screen looks at the "Notepad." If the notepad says _"Node 5 was changed,"_ the screen automatically applies a CSS class to highlight Node 5 in orange. If it says _"Node 6 was added,"_ it highlights it in green.

### References