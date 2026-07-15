/* This file is used to track the history of edits made to the model.
 * Created mainly to support undo and redo so we can preserve snapshots of the graph
 * Author: Luray He
 */
import { cloneGraphModules } from './model-editor.js';
import { cloneAmbapbEditingState } from './ambapb-editor.js';

const cloneDeltaSnapshot = (snapshot) => {
    if (!snapshot) {
        return null;
    }
    return {
        original: Array.isArray(snapshot.original) ? snapshot.original.map(([key, value]) => {
            if (Array.isArray(value)) {
                return [key, value.slice()];
            }
            return [key, value];
        }) : [],
        changes: Array.isArray(snapshot.changes) ? snapshot.changes.map((change) => {
            const cloned = { ...change };
            if (Array.isArray(change.newValue)) {
                cloned.newValue = change.newValue.slice();
            }
            return cloned;
        }) : []
    };
};

export class EditHistory {

    // stack to pop off most frequent change
    constructor(maxSize = 50) {
        this._undoStack = [];
        this._redoStack = [];
        this._maxSize = maxSize;
        this._lastFocus = null;
    }

    get canUndo() {
        return this._undoStack.length > 0;
    }

    get canRedo() {
        return this._redoStack.length > 0;
    }

    get lastFocus() {
        return this._lastFocus;
    }

    checkpoint(session) {
        this._undoStack.push(this._capture(session));
        if (this._undoStack.length > this._maxSize) {
            this._undoStack.shift();
        }
        this._redoStack = [];
    }

    setLastFocus(focus) {
        if (this._undoStack.length === 0) {
            return;
        }
        this._undoStack[this._undoStack.length - 1].focus = focus ? { ...focus } : null;
    }

    undo(session) {
        if (!this.canUndo) {
            return false;
        }
        const previous = this._undoStack.pop();
        const current = this._capture(session);
        current.focus = previous.focus || null;
        this._redoStack.push(current);
        this._restore(session, previous);
        this._lastFocus = previous.focus || null;
        return true;
    }

    redo(session) {
        if (!this.canRedo) {
            return false;
        }
        const previous = this._redoStack.pop();
        const current = this._capture(session);
        current.focus = previous.focus || null;
        this._undoStack.push(current);
        this._restore(session, previous);
        this._lastFocus = previous.focus || null;
        return true;
    }

    clear() {
        this._undoStack = [];
        this._redoStack = [];
        this._lastFocus = null;
    }

    _capture(session) {
        const snapshot = {
            modules: cloneGraphModules(session.modified.model.modules),
            delta: cloneDeltaSnapshot(session.delta.exportSnapshot()),
            batchInlineExpanded: Array.isArray(session.batchInlineExpanded)
                ? session.batchInlineExpanded.slice()
                : []
        };
        if (session.modified.model._ambapb) {
            snapshot.ambapb = cloneAmbapbEditingState(session.modified.model._ambapb);
        }
        return snapshot;
    }

    // restore the session to the previous snapshot
    _restore(session, snapshot) {
        session.modified.model.modules = cloneGraphModules(snapshot.modules);
        if (snapshot.ambapb) {
            const ambapb = cloneAmbapbEditingState(snapshot.ambapb);
            session.modified.model._ambapb = ambapb;
            if (session.original._ambapb) {
                session.original._ambapb.primGraph = ambapb.primGraph;
            }
        }
        session.delta.restoreSnapshot(snapshot.delta);
        session.batchInlineExpanded = Array.isArray(snapshot.batchInlineExpanded) 
            ? snapshot.batchInlineExpanded.slice()
            : [];
    }
}
