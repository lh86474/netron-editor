2026-06-08

Tags: [[ambarella]] [[netron]]
## changes in view.js phase1-3

### Notes

### 1. Imports & view.View state

- **The Setup:** We brought in new tools to handle editing (like **`ModelEditor`** and **`AttributeSchemaResolver`**) and a new container for the split screens (**`GraphPane`**).
    
- **The State (`view.View`):** The main application manager now has new memory slots to keep track of the editing workspace.
    
    - It holds the core editing environment (**`_editSession`**) and watches for errors (**`_editSessionError`**).
        
    - It maintains the two halves of the screen (**`_leftPane`** and **`_rightPane`**) and constantly tracks which side your mouse is interacting with (**`_activePane`**), defaulting to the modified side.
        
    - It also holds a kill-switch (**`_deltaUnsubscribe`**) to stop listening for edits if we need to close the session.
        

### 2. Model open & debug (view.View)

- **Starting Up (`open`):** When you load a file, the system finishes reading it and immediately asks **`ModelEditor.createSession()`** to generate a parallel editing workspace, storing it in **`_editSession`**.
    
- **Screen Setup:** It then calls **`_initGraphPanes()`** to physically split the screen into the `#target-original` and `#target-modified` zones.
    
- **Listening for Changes:** **`_bindEditorSession()`** is called to wire up the right pane so it starts listening for any modifications you make.
    
- **Developer Tools:** We added **`_registerDebugEditorState()`** and **`debugEditorState()`**. These are "under the hood" tools that let you open the browser console and check the exact health of the panes, the edit history, and the state of the session without needing to click through the UI.
    

### 3. Dual-pane orchestration

- **Traffic Control:** This section manages the two independent graphs.
    
    - **`_renderGraphInPane()`** is the engine that actually draws the network diagram inside one specific pane container.
        
    - **`_resolveModifiedTarget()`** ensures that if you navigate to a specific node on the original graph, the modified graph syncs up and points to the same spot.
        
    - **`_activePaneGraph()`** acts as a smart switch. When you use the zoom toolbar, it checks this function to make sure it only zooms the graph you are currently focused on, rather than zooming both at once.
        
- **Rendering:** **`render()`** handles the heavy lifting of drawing both screens when the app first loads. Later, **`_refreshModifiedPane()`** and **`refresh()`** allow us to quickly update just the right side after an edit, keeping your scroll position and zoom level exactly where you left them.
    

### 4. Edit pipeline (Phase 3)

- **The Conveyor Belt:** When you change something in the UI, **`applyEditorPatch()`** grabs that change, logs it, and pushes it into the `_editSession`.
    
- **The Reaction:** **`_handleEditorDelta()`** catches the echo of that change. It updates the sidebar and then asks **`_editorChangeNeedsGraphRefresh()`** a critical question: "Did this edit change the physical shape of the graph (like renaming a node), or just a background detail?" This decides if we need to redraw the canvas.
    
- **Visual Glitch Fix:** **`_applyScreen()`** and **`_ensureDefaultScreen()`** were created to fix a bug where making an edit would accidentally strip away the standard screen layout and briefly flash the Netron startup logo.
    

### 5. Sidebar routing

- **Smart Menus:** The system now decides which slide-out menu you get based on where you click.
    
- If you click a node or connection on the left side, **`showNodeProperties()`** and **`showConnectionProperties()`** give you the classic, read-only **`NodeSidebar`**.
    
- If you click on the right side (and **`_editSession`** exists), it routes you to the new **`EditableNodeSidebar`** or **`EditableConnectionSidebar`**, unlocking the ability to make changes.
    

### 6. New editable sidebar classes

- **The Interactive Building Blocks:** We built an entirely new suite of UI components (over 350 lines of code) starting with **`EditableObjectSidebar`**.
    
- Instead of just showing static text, we created **`EditableTextView`** and **`EditableAttributeView`**. These components generate actual input boxes that let you parse data, format text, delete attributes with a button, and save your changes by hitting 'Enter' or clicking away (blur).
    

### 7. view.Graph refactor (pane-scoped DOM)

- **Containing the Canvas:** Previously, Netron's drawing engine (**`view.Graph`**) assumed it owned the entire webpage and aggressively looked for a global `#target` and `#canvas`. We rewrote the constructor so it now accepts specific boundaries (**`container`** and **`paneId`**).
    
- **CSS Isolation:** We added **`_injectPaneStyles()`** and **`markerPrefix`**. Because SVG elements (like the little arrowheads on connection lines) use global URL references, the left graph and right graph were visually clashing. This fix ensures the "modified-arrowhead" doesn't accidentally show up on the "original-canvas."
    

### 8. Read-only & interaction guards

- **Security Bouncers:** We added safety checks inside the interaction functions (**`view.Graph.activate()`**, **`view.Node.activate()`**, etc.). If the system sees that **`context.readOnly`** is true (which it always is for the left pane), it immediately blocks the action and logs `[editor] activate blocked: readOnly`, preventing any accidental cross-contamination of edits.
    

### 9. view.Node — incremental attribute display

- **Performance Boost:** We extracted the logic for drawing a node's internal text list into **`_populateArgumentList`**.
    
- Now, if you use the sidebar to add a new attribute, **`rebuildArgumentList()`** simply erases the text inside that specific node and redraws it. This completely skips the massive, CPU-heavy process of recalculating the layout of the entire graph just to add one line of text.
    

### 10. Render hooks

- **Visual Highlighters:** We connected the visual styling directly to your edit history.
    
- **`view.Node`** and **`view.Value`** both use **`applyDeltaStyle()`**. This function asks the tracker (**`deltaTracker.getAggregateState()`**) if this specific item has been edited. If it has, it automatically applies the correct CSS class to highlight the modified node or connection line, without needing a full graph rebuild.
    




