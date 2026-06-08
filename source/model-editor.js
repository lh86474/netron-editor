
import { DeltaTracker } from './delta-tracker.js';

const readType = (type) => {
    if (!type) {
        return {};
    }
    const result = {};
    for (const key of ['name', 'identifier', 'category', 'module', 'version']) {
        if (type[key] !== undefined) {
            result[key] = type[key];
        }
    }
    if (Array.isArray(type.attributes)) {
        result.attributes = type.attributes.map((entry) => ({
            name: entry.name,
            type: entry.type,
            default: entry.default,
            required: entry.required
        }));
    }
    return result;
};

const normalizeScalar = (value) => {
    if (typeof value === 'bigint') {
        if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
            return Number(value);
        }
        return value.toString();
    }
    return value;
};

const cloneAttributeValue = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeScalar(item));
    }
    return normalizeScalar(value);
};

export const stringifyEditorJSON = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);

const trackArgumentValues = (argument, track) => {
    if (!argument || !Array.isArray(argument.value)) {
        return;
    }
    for (const value of argument.value) {
        track(value);
    }
};

export const enumerateGraphValues = (graph, graphIndex) => {
    const map = new Map();
    let index = 0;
    const track = (value) => {
        if (!value || map.has(value)) {
            return;
        }
        map.set(value, `graph:${graphIndex}/value:${index++}`);
    };
    for (const input of graph.inputs || []) {
        trackArgumentValues(input, track);
    }
    for (const output of graph.outputs || []) {
        trackArgumentValues(output, track);
    }
    for (const node of graph.nodes || []) {
        for (const input of node.inputs || []) {
            trackArgumentValues(input, track);
        }
        for (const output of node.outputs || []) {
            trackArgumentValues(output, track);
        }
    }
    return map;
};

const readModel = (model) => {
    const valueMap = new Map();
    const cloneValue = (value) => {
        if (value === null || value === undefined) {
            return null;
        }
        if (valueMap.has(value)) {
            return valueMap.get(value);
        }
        const cloned = { name: value.name };
        if (value.type !== undefined) {
            cloned.type = value.type;
        }
        if (value.description !== undefined) {
            cloned.description = value.description;
        }
        valueMap.set(value, cloned);
        return cloned;
    };
    const readArgumentValues = (argument) => {
        const source = argument.value;
        if (source === null || source === undefined) {
            return [];
        }
        if (Array.isArray(source)) {
            return source.map((value) => cloneValue(value)).filter((value) => value !== null);
        }
        const cloned = cloneValue(source);
        return cloned === null ? [] : [cloned];
    };
    const readArgument = (argument) => {
        return {
            name: argument.name,
            value: readArgumentValues(argument)
        };
    };
    const readAttribute = (attribute) => {
        const result = {
            name: attribute.name,
            type: attribute.type,
            value: cloneAttributeValue(attribute.value)
        };
        if (attribute.visible === false) {
            result.visible = false;
        }
        return result;
    };
    const readNode = (node) => ({
        name: node.name,
        type: readType(node.type),
        attributes: (node.attributes || []).map((attribute) => readAttribute(attribute)),
        inputs: (node.inputs || []).map((input) => readArgument(input)),
        outputs: (node.outputs || []).map((output) => readArgument(output))
    });
    const readGraph = (graph) => ({
        name: graph.name,
        identifier: graph.identifier,
        inputs: (graph.inputs || []).map((input) => readArgument(input)),
        outputs: (graph.outputs || []).map((output) => readArgument(output)),
        nodes: (graph.nodes || []).map((node) => readNode(node))
    });
    return {
        format: model.format,
        modules: (model.modules || []).map((graph) => readGraph(graph))
    };
};

const parseNodeEntityId = (entityId) => {
    const match = /^graph:(\d+)\/node:(\d+)(?:\/attr:(\d+))?$/.exec(entityId);
    if (!match) {
        throw new Error(`Invalid entityId: ${entityId}`);
    }
    return {
        graphIndex: Number(match[1]),
        nodeIndex: Number(match[2]),
        attributeIndex: match[3] !== undefined ? Number(match[3]) : null
    };
};

const parseValueEntityId = (entityId) => {
    const match = /^graph:(\d+)\/value:(\d+)$/.exec(entityId);
    if (!match) {
        throw new Error(`Invalid value entityId: ${entityId}`);
    }
    return {
        graphIndex: Number(match[1]),
        valueIndex: Number(match[2])
    };
};

const attributeNameFromProperty = (property) => {
    const prefix = 'attributes.';
    if (!property.startsWith(prefix)) {
        throw new Error(`Unsupported property: ${property}`);
    }
    return property.slice(prefix.length);
};

const getValueByEntityId = (model, entityId) => {
    const location = parseValueEntityId(entityId);
    const graph = model.modules[location.graphIndex];
    if (!graph) {
        return null;
    }
    for (const [value, id] of enumerateGraphValues(graph, location.graphIndex)) {
        if (id === entityId) {
            return value;
        }
    }
    return null;
};

const buildOriginalSnapshot = (model) => {
    const snapshot = new Map();
    model.modules.forEach((graph, graphIndex) => {
        graph.nodes.forEach((node, nodeIndex) => {
            const nodeId = `graph:${graphIndex}/node:${nodeIndex}`;
            snapshot.set(nodeId, node.name);
            node.attributes.forEach((attribute, attributeIndex) => {
                const attributeId = `${nodeId}/attr:${attributeIndex}`;
                snapshot.set(attributeId, cloneAttributeValue(attribute.value));
            });
        });
        for (const [value, valueId] of enumerateGraphValues(graph, graphIndex)) {
            snapshot.set(`${valueId}:name`, value.name);
            if (value.type !== undefined) {
                snapshot.set(`${valueId}:type`, value.type);
            }
        }
    });
    return snapshot;
};

export const AttributeSchemaResolver = {

    lookup(nodeType, attributeName) {
        if (!nodeType || !Array.isArray(nodeType.attributes)) {
            return null;
        }
        return nodeType.attributes.find((entry) => entry.name === attributeName) || null;
    },

    resolveType(nodeType, attributeName) {
        const schema = this.lookup(nodeType, attributeName);
        return schema && schema.type ? schema.type : 'string';
    },

    validateName(node, attributeName, excludeIndex = -1) {
        if (!attributeName) {
            return 'Attribute name is required';
        }
        const attributes = node.attributes || [];
        for (let index = 0; index < attributes.length; index++) {
            if (index !== excludeIndex && attributes[index].name === attributeName) {
                return `Attribute '${attributeName}' already exists`;
            }
        }
        return null;
    },

    parseValue(text, type) {
        const trimmed = text.trim();
        if (type && type.includes('[]')) {
            if (!trimmed) {
                return [];
            }
            const parts = trimmed.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
            if (type.startsWith('float')) {
                return parts.map((part) => Number.parseFloat(part));
            }
            if (type.startsWith('int')) {
                return parts.map((part) => Number.parseInt(part, 10));
            }
            return parts;
        }
        if (type === 'float' || type === 'float32' || type === 'float64') {
            return Number.parseFloat(trimmed);
        }
        if (type === 'int' || type === 'int32' || type === 'int64') {
            return Number.parseInt(trimmed, 10);
        }
        return trimmed;
    }
};

class EditableModel {

    constructor(model) {
        this._model = model;
    }

    get model() {
        return this._model;
    }

    getGraph(graphIndex = 0) {
        return this._model.modules[graphIndex];
    }
}

class EditorState {

    constructor(original) {
        this._original = original;
        const normalized = readModel(original);
        this.modified = new EditableModel(normalized);
        this._snapshot = buildOriginalSnapshot(normalized);
        this.delta = new DeltaTracker(this._snapshot);
    }

    get original() {
        return this._original;
    }

    applyPatch(patch) {
        let entityId = patch.entityId;
        let changeType = patch.changeType;

        if (patch.changeType === 'add' && patch.entityType === 'attribute') {
            const location = parseNodeEntityId(patch.parentId);
            const graph = this.modified.getGraph(location.graphIndex);
            const node = graph.nodes[location.nodeIndex];
            const name = attributeNameFromProperty(patch.property);
            const attributeType = patch.attributeType || AttributeSchemaResolver.resolveType(node.type, name);
            node.attributes.push({
                name,
                type: attributeType,
                value: Array.isArray(patch.newValue) ? patch.newValue.slice() : patch.newValue
            });
            entityId = `${patch.parentId}/attr:${node.attributes.length - 1}`;
        } else if (patch.changeType === 'delete' && patch.entityType === 'attribute') {
            const location = parseNodeEntityId(entityId);
            const graph = this.modified.getGraph(location.graphIndex);
            const node = graph.nodes[location.nodeIndex];
            node.attributes.splice(location.attributeIndex, 1);
        } else if (patch.entityType === 'value') {
            const value = getValueByEntityId(this.modified.model, entityId);
            if (!value) {
                throw new Error(`Value not found for entityId: ${entityId}`);
            }
            if (patch.property === 'name') {
                value.name = patch.newValue;
            } else if (patch.property === 'type') {
                value.type = patch.newValue;
            } else if (patch.property === 'description') {
                value.description = patch.newValue;
            } else {
                throw new Error(`Unsupported value property: ${patch.property}`);
            }
        } else {
            const location = parseNodeEntityId(entityId.includes('/attr:') ? entityId : patch.parentId || entityId);
            const graph = this.modified.getGraph(location.graphIndex);
            const node = graph.nodes[location.nodeIndex];

            if (patch.entityType === 'attribute') {
                const attributeLocation = parseNodeEntityId(entityId);
                const attribute = node.attributes[attributeLocation.attributeIndex];
                attribute.value = Array.isArray(patch.newValue) ? patch.newValue.slice() : patch.newValue;
            } else if (patch.entityType === 'node' && patch.property === 'name') {
                node.name = patch.newValue;
            } else {
                throw new Error(`Unsupported patch: ${JSON.stringify(patch)}`);
            }
        }

        const change = {
            entityId,
            entityType: patch.entityType,
            changeType,
            property: patch.property,
            newValue: patch.newValue
        };
        this.delta.record(change);
        const recorded = this.delta.getChanges().find((entry) => entry.entityId === entityId);
        return recorded || {
            entityId,
            entityType: patch.entityType,
            changeType,
            property: patch.property,
            oldValue: undefined,
            newValue: patch.newValue
        };
    }
}

export const locateNodeEntity = function(model, node) {
    const modules = model.modules || [];
    for (let graphIndex = 0; graphIndex < modules.length; graphIndex++) {
        const graph = modules[graphIndex];
        const nodes = graph.nodes || [];
        const nodeIndex = nodes.indexOf(node);
        if (nodeIndex >= 0) {
            return {
                graphIndex,
                nodeIndex,
                nodeId: `graph:${graphIndex}/node:${nodeIndex}`
            };
        }
    }
    return null;
};

export const locateValueEntity = function(model, value) {
    const modules = model.modules || [];
    for (let graphIndex = 0; graphIndex < modules.length; graphIndex++) {
        const graph = modules[graphIndex];
        for (const [entry, valueId] of enumerateGraphValues(graph, graphIndex)) {
            if (entry === value) {
                return {
                    graphIndex,
                    valueId
                };
            }
        }
    }
    return null;
};

export class ModelEditor {

    static createSession(model) {
        return new EditorState(model);
    }

    static cloneFrom(model) {
        return new EditableModel(readModel(model));
    }
}
