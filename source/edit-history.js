/* This file is used to track the history of edits made to the model.
 * Created mainly to support undo and redo so we can preserve snapshops of the graph
 * Author: Luray He
 */
import { cloneGraphModules, stringifyEditorJSON } from './model-editor.js';

const cloneData = (value) => JSON.parse(stringifyEditorJSON(value));

export class EditHistory {

    // stack to pop off most frequent change
    constructor(maxSize = 50) {
        this._undoStack = [];
        this._redoStack = [];
        this._maxSize = maxSize;
    }

    get canUndo() {
        return this._undoStack.length > 0;
    }

    get canRedo() {
        return this._redoStack.length > 0;
    }

    checkpoint(session) {
        this._undoStack.push(this._capture(session));
        if (this._undoStack.length > this._maxSize) {
            this._undoStack.shift();
        }
        this._redoStack = [];
    }

    undo(session) {
        if (!this.canUndo) {
            return false;
        }
        this._redoStack.push(this._capture(session));
        this._restore(session, this._undoStack.pop());
        return true;
    }

    redo(session) {
        if (!this.canRedo) {
            return false;
        }
        this._undoStack.push(this._capture(session));
        this._restore(session, this._redoStack.pop());
        return true;
    }

    clear() {
        this._undoStack = [];
        this._redoStack = [];
    }

    _capture(session) {
        return {
            modules: cloneGraphModules(session.modified.model.modules),
            delta: cloneData(session.delta.exportSnapshot())
        };
    }

    // restore the session to the previous snapshot
    _restore(session, snapshot) {
        session.modified.model.modules = cloneGraphModules(snapshot.modules);
        session.delta.restoreSnapshot(snapshot.delta);
    }
}
