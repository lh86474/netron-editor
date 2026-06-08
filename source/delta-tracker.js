
const scalarEqual = (a, b) => {
    if (a === b) {
        return true;
    }
    if (typeof a === 'bigint' || typeof b === 'bigint') {
        return String(a) === String(b);
    }
    return false;
};

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

export class DeltaTracker {

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

    record(change) {
        const snapshotKey = this._snapshotKey(change);
        const originalValue = this._original.get(snapshotKey);
        const existsInOriginal = this._original.has(snapshotKey);
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

    getState(entityId) {
        const change = this._changes.get(entityId);
        if (!change) {
            return 'unchanged';
        }
        return change.changeType === 'add' ? 'added' : change.changeType === 'delete' ? 'deleted' : 'modified';
    }

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

    subscribe(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _emit() {
        for (const callback of this._listeners) {
            callback(this.getChanges());
        }
    }
}
