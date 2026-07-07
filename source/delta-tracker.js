/*
    This file mainly defines the DeltaTracker class and some other helper functions
    The main purpose of this file is to have a goodnotepad of all ofthe changes that the user has made
    to the modified graph
    Author: Luray He
*/

/*
 A lot of equality checks to compare changes to the original graph
 False denotes that there is a change. 
*/
const scalarEqual = (a, b) => {
    if (a === b) {
        return true;
    }
    if (typeof a === 'bigint' || typeof b === 'bigint') {
        return String(a) === String(b);
    }
    return false;
};
// For more complicated objects like Arrays
const deepEqual = (a, b) => {
    if (scalarEqual(a, b)) {
        return true;
    }
    if (a === null || b === null || typeof a !== typeof b) {
        return false;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }
    if (typeof a === 'number' && typeof b === 'number') {
        return a === b;
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) {
            return false;
        }
        for (const key of keysA) {
            if (!deepEqual(a[key], b[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
};

// The actual tracker
// Creatively amed by composer 2.5. Delta means change
export class DeltaTracker {
    // this._changes is quite important because the getter function is used very frequently in onnx-export.js
    // orignialSnapshot is created with buildOriginalSnapshot in model-editor.js
    constructor(originalSnapshot) {
        this._original = originalSnapshot;
        this._changes = new Map();
        this._listeners = new Set();
    }

    _snapshotKey(change) {
        if (change.property === 'name' || change.property === 'type' || change.property === 'description') {
            return `${change.entityId}:${change.property}`;
        }
        return change.entityId;
    }

    // This is the actual recorder. 
    // We get some change from the editor, which include name, type, and description
    record(change) {
        const snapshotKey = this._snapshotKey(change);
        const originalValue = this._original.get(snapshotKey);
        const existsInOriginal = this._original.has(snapshotKey);
        // handles delete
        if (change.changeType === 'delete') {
            if (!existsInOriginal) {
                this._changes.delete(change.entityId);
            } else {
                this._changes.set(change.entityId, change);
            }
        } else if (!existsInOriginal) {
            this._changes.set(change.entityId, { ...change, changeType: 'add', oldValue: undefined });
        } else if (deepEqual(change.newValue, originalValue)) {
            this._changes.delete(change.entityId);
        } else {
            this._changes.set(change.entityId, {
                ...change,
                changeType: 'modify',
                oldValue: originalValue
            });
        }
        this._emit();
        return this._changes.get(change.entityId) || null;
    }

    // add , delete, or modified
    getState(entityId) {
        const change = this._changes.get(entityId);
        if (!change) {
            return 'unchanged';
        }
        return change.changeType === 'add' ? 'added' : change.changeType === 'delete' ? 'deleted' : 'modified';
    }
    // checks if directerd children or nested entities have been deleted or modified
    getAggregateState(parentId) {
        const prefix = `${parentId}/`;
        let aggregate = 'unchanged';
        for (const [entityId, change] of this._changes) {
            if (entityId === parentId || entityId.startsWith(prefix)) {
                if (change.changeType === 'delete') {
                    return 'deleted';
                }
                aggregate = 'modified';
            }
        }
        return aggregate;
    }

    // returns all changes in an array
    getChanges() {
        return Array.from(this._changes.values());
    }

    toJSON() {
        return this.getChanges();
    }

    toAggregateJSON() {
        const aggregates = {};
        for (const entityId of this._changes.keys()) {
            const attrIndex = entityId.indexOf('/attr:');
            const parentId = attrIndex !== -1 ? entityId.slice(0, attrIndex) : entityId;
            aggregates[parentId] = this.getAggregateState(parentId);
        }
        return aggregates;
    }

    // to support undo
    restore(changes) {
        this._changes = new Map();
        for (const change of changes) {
            this._changes.set(change.entityId, { ...change });
        }
        this._emit();
    }
    // to support undo
    clearEntity(entityId) {
        if (this._changes.delete(entityId)) {
            this._emit();
        }
    }
    // to support redo
    exportSnapshot() {
        return {
            original: Array.from(this._original.entries()),
            changes: this.getChanges().map((change) => ({ ...change }))
        };
    }

    restoreSnapshot(snapshot) {
        this._original = new Map(snapshot.original);
        this.restore(snapshot.changes);
    }

    subscribe(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _remapEntityId(entityId, graphIndex, fromIndex, offset) {
        const prefix = `graph:${graphIndex}/node:`;
        if (!entityId.startsWith(prefix)) {
            return entityId;
        }
        const rest = entityId.slice(prefix.length);
        const match = /^(\d+)(\/attr:\d+)?$/.exec(rest);
        if (!match) {
            return entityId;
        }
        const nodeIndex = Number(match[1]);
        if (nodeIndex < fromIndex) {
            return entityId;
        }
        return `${prefix}${nodeIndex + offset}${match[2] || ''}`;
    }

    remapNodeIndices(graphIndex, fromIndex, offset) {
        if (!offset) {
            return false;
        }
        let changed = false;
        const remappedChanges = new Map();
        for (const [entityId, change] of this._changes) {
            const newId = this._remapEntityId(entityId, graphIndex, fromIndex, offset);
            const newChange = { ...change, entityId: newId };
            if (change.parentId) {
                newChange.parentId = this._remapEntityId(change.parentId, graphIndex, fromIndex, offset);
            }
            if (newId !== entityId) {
                changed = true;
            }
            remappedChanges.set(newId, newChange);
        }
        if (changed) {
            this._changes = remappedChanges;
        }
        const remappedOriginal = new Map();
        for (const [key, value] of this._original) {
            const nodeKeyMatch = /^graph:(\d+)\/node:(\d+)(\/attr:\d+)?$/.exec(key);
            if (nodeKeyMatch && Number(nodeKeyMatch[1]) === graphIndex && Number(nodeKeyMatch[2]) >= fromIndex) {
                const newKey = `graph:${nodeKeyMatch[1]}/node:${Number(nodeKeyMatch[2]) + offset}${nodeKeyMatch[3] || ''}`;
                remappedOriginal.set(newKey, value);
                changed = true;
            } else {
                remappedOriginal.set(key, value);
            }
        }
        if (changed) {
            this._original = remappedOriginal;
        }
        return changed;
    }

    _remapKey(key, orderedEntries) {
        for (const [oldPrefix, newPrefix] of orderedEntries) {
            if (key === oldPrefix || key.startsWith(`${oldPrefix}/`) || key.startsWith(`${oldPrefix}:`)) {
                return newPrefix + key.slice(oldPrefix.length);
            }
        }
        return key;
    }

    remapEntities(idMap) {
        if (!idMap || idMap.size === 0) {
            return false;
        }
        const orderedEntries = [...idMap.entries()].sort(
            (a, b) => b[0].length - a[0].length
        );
        const remappedPrefixes = new Set(idMap.keys());

        const remappedChanges = new Map();
        for (const [entityId, change] of this._changes) {
            const wasMoved = remappedPrefixes.has(entityId) ||
                [...remappedPrefixes].some((old) => entityId.startsWith(`${old}/`));
            const newId = this._remapKey(entityId, orderedEntries);

            if (wasMoved && newId === entityId) {
                continue;
            }
            remappedChanges.set(newId, {
                ...change,
                entityId: newId,
                parentId: change.parentId ?
                    this._remapKey(change.parentId, orderedEntries):
                    change.parentId
            });
        }
        this._changes = remappedChanges;

        const remappedOriginal = new Map();
        for (const [key, value] of this._original) {
            remappedOriginal.set(this._remapKey(key, orderedEntries), value);
        }
        this._original = remappedOriginal;

        this._emit();
        return true;
    }

_emit() {
        for (const callback of this._listeners) {
            callback(this.getChanges());
        }
    }
}
