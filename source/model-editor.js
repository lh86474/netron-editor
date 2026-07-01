
import { DeltaTracker } from './delta-tracker.js';
import { EditHistory } from './edit-history.js';
import {
    assertAmbapbAttributePatchAllowed,
    attachAmbapbEditingState,
    getPrimGraphSnapshotValue,
    isAmbapbShellNode,
    PRIM_GRAPH_ATTRIBUTE,
    syncShellAttribute,
    validateAmbapbPatch
} from './ambapb-editor.js';

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

const argumentValues = (argument) => {
    if (!argument || argument.value === null || argument.value === undefined) {
        return [];
    }
    return Array.isArray(argument.value) ? argument.value : [argument.value];
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
        if (value.initializer !== undefined) {
            cloned.initializer = value.initializer;
        }
        if (Array.isArray(value.attributes)) {
            cloned.attributes = value.attributes.map((attribute) => readAttribute(attribute));
        } else if (Array.isArray(value.metadata)) {
            cloned.attributes = value.metadata.map((entry) => ({
                name: entry.name,
                type: 'string',
                value: cloneAttributeValue(entry.value)
            }));
        } else {
            cloned.attributes = [];
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
    const readNode = (node) => {
        const result = {
            name: node.name,
            type: readType(node.type),
            attributes: (node.attributes || []).map((attribute) => readAttribute(attribute)),
            inputs: (node.inputs || []).map((input) => readArgument(input)),
            outputs: (node.outputs || []).map((output) => readArgument(output))
        };
        if (node.description !== undefined) {
            result.description = node.description;
        }
        if (node._primitiveId !== undefined) {
            result._primitiveId = node._primitiveId;
        }
        if (node._primitiveIndex !== undefined) {
            result._primitiveIndex = node._primitiveIndex;
        }
        return result;
    };
    const readGraph = (graph) => {
        const result = {
            name: graph.name,
            identifier: graph.identifier,
            inputs: (graph.inputs || []).map((input) => readArgument(input)),
            outputs: (graph.outputs || []).map((output) => readArgument(output)),
            nodes: (graph.nodes || []).map((node) => readNode(node))
        };
        if (graph._ambapb) {
            result._ambapb = true;
        }
        if (graph._ambapbCompiledGraph) {
            result._ambapbCompiledGraph = true;
        }
        return result;
    };
    return {
        format: model.format,
        modules: (model.modules || []).map((graph) => readGraph(graph))
    };
};

const NESTED_COMPILED_NODE_ENTITY_RE =
    /^graph:(\d+)\/node:(\d+)\/([^/]+)\/node:(\d+)(?:\/attr:(\d+))?$/;

const nodeGraphArguments = (node) => {
    if (!node) {
        return [];
    }
    return (node.attributes || []).concat(node.blocks || []);
};

export const isNestedCompiledNodeEntityId = (entityId) => {
    return Boolean(entityId && NESTED_COMPILED_NODE_ENTITY_RE.test(entityId));
};

const parseNestedCompiledNodeEntityId = (entityId) => {
    const match = NESTED_COMPILED_NODE_ENTITY_RE.exec(entityId);
    if (!match) {
        return null;
    }
    return {
        graphIndex: Number(match[1]),
        hostNodeIndex: Number(match[2]),
        graphAttrName: match[3],
        subNodeIndex: Number(match[4]),
        attributeIndex: match[5] !== undefined ? Number(match[5]) : null
    };
};

const getNestedCompiledGraphNode = (model, location) => {
    const graph = model.modules[location.graphIndex];
    const hostNode = graph && graph.nodes ? graph.nodes[location.hostNodeIndex] : null;
    if (!hostNode) {
        return null;
    }
    const graphEntry = nodeGraphArguments(hostNode).find(
        (entry) => entry.name === location.graphAttrName && entry.type === 'graph' && entry.value
    );
    if (!graphEntry || !Array.isArray(graphEntry.value.nodes)) {
        return null;
    }
    return {
        hostNode,
        subGraph: graphEntry.value,
        node: graphEntry.value.nodes[location.subNodeIndex] || null
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

const parseAttributeEntityId = (entityId) => {
    const nestedMatch = NESTED_COMPILED_NODE_ENTITY_RE.exec(entityId);
    if (nestedMatch) {
        return {
            graphIndex: Number(nestedMatch[1]),
            target: 'nested-node',
            hostNodeIndex: Number(nestedMatch[2]),
            graphAttrName: nestedMatch[3],
            targetIndex: Number(nestedMatch[4]),
            attributeIndex: nestedMatch[5] !== undefined ? Number(nestedMatch[5]) : null
        };
    }
    const nodeMatch = /^graph:(\d+)\/node:(\d+)(?:\/attr:(\d+))?$/.exec(entityId);
    if (nodeMatch) {
        return {
            graphIndex: Number(nodeMatch[1]),
            target: 'node',
            targetIndex: Number(nodeMatch[2]),
            attributeIndex: nodeMatch[3] !== undefined ? Number(nodeMatch[3]) : null
        };
    }
    const valueMatch = /^graph:(\d+)\/value:(\d+)(?:\/attr:(\d+))?$/.exec(entityId);
    if (valueMatch) {
        return {
            graphIndex: Number(valueMatch[1]),
            target: 'value',
            targetIndex: Number(valueMatch[2]),
            attributeIndex: valueMatch[3] !== undefined ? Number(valueMatch[3]) : null
        };
    }
    throw new Error(`Invalid attribute entityId: ${entityId}`);
};

const parseAttributeParentId = (parentId) => {
    const nestedMatch = NESTED_COMPILED_NODE_ENTITY_RE.exec(parentId);
    if (nestedMatch && nestedMatch[5] === undefined) {
        return {
            graphIndex: Number(nestedMatch[1]),
            target: 'nested-node',
            hostNodeIndex: Number(nestedMatch[2]),
            graphAttrName: nestedMatch[3],
            targetIndex: Number(nestedMatch[4])
        };
    }
    const nodeMatch = /^graph:(\d+)\/node:(\d+)$/.exec(parentId);
    if (nodeMatch) {
        return {
            graphIndex: Number(nodeMatch[1]),
            target: 'node',
            targetIndex: Number(nodeMatch[2])
        };
    }
    const valueMatch = /^graph:(\d+)\/value:(\d+)$/.exec(parentId);
    if (valueMatch) {
        return {
            graphIndex: Number(valueMatch[1]),
            target: 'value',
            targetIndex: Number(valueMatch[2])
        };
    }
    throw new Error(`Invalid attribute parentId: ${parentId}`);
};

const getAttributeTarget = (model, location) => {
    if (location.target === 'nested-node') {
        const resolved = getNestedCompiledGraphNode(model, {
            graphIndex: location.graphIndex,
            hostNodeIndex: location.hostNodeIndex,
            graphAttrName: location.graphAttrName,
            subNodeIndex: location.targetIndex
        });
        if (!resolved || !resolved.node) {
            throw new Error(`Nested node not found for attribute target.`);
        }
        return resolved.node;
    }
    if (location.target === 'node') {
        const graph = model.modules[location.graphIndex];
        return graph.nodes[location.targetIndex];
    }
    const valueId = `graph:${location.graphIndex}/value:${location.targetIndex}`;
    const value = getValueByEntityId(model, valueId);
    if (!value) {
        throw new Error(`Value not found for entityId: ${valueId}`);
    }
    return value;
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

export const collectGraphValueNames = (graph) => {
    const names = new Set();
    const track = (value) => {
        if (value && value.name) {
            names.add(value.name);
        }
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
    return names;
};

export const genUniqueTensorName = (prefix, graph) => {
    const names = collectGraphValueNames(graph);
    let index = 0;
    let name = prefix;
    while (names.has(name)) {
        index++;
        name = `${prefix}_${index}`;
    }
    names.add(name);
    return name;
};

export const genUniqueNodeName = (prefix, graph) => {
    const names = new Set((graph.nodes || []).map((node) => node.name).filter(Boolean));
    let index = 0;
    let name = prefix;
    while (names.has(name)) {
        index++;
        name = `${prefix}_${index}`;
    }
    return name;
};

export class SubgraphExtractError extends Error {

    constructor(message) {
        super(message);
        this.name = 'SubgraphExtractError';
    }
}

export const findValueProducers = (graph, value) => {
    const producers = [];
    if (!value) {
        return producers;
    }
    const valueName = value.name;
    const matches = (candidate) => candidate === value || (valueName && candidate && candidate.name === valueName);
    for (const input of graph.inputs || []) {
        for (let index = 0; index < argumentValues(input).length; index++) {
            const value = argumentValues(input)[index];
            if (matches(value)) {
                producers.push({ node: null, argument: input, index, graphInput: true });
            }
        }
    }
    for (const node of graph.nodes || []) {
        for (const output of node.outputs || []) {
            for (let index = 0; index < argumentValues(output).length; index++) {
                const value = argumentValues(output)[index];
                if (matches(value)) {
                    producers.push({ node, argument: output, index });
                }
            }
        }
    }
    return producers;
};

export const findValueConsumers = (graph, value) => {
    const consumers = [];
    if (!value) {
        return consumers;
    }
    const valueName = value.name;
    const matches = (candidate) => candidate === value || (valueName && candidate && candidate.name === valueName);
    for (const node of graph.nodes || []) {
        for (const input of node.inputs || []) {
            for (let index = 0; index < argumentValues(input).length; index++) {
                const value = argumentValues(input)[index];
                if (matches(value)) {
                    consumers.push({ node, argument: input, index });
                }
            }
        }
    }
    for (const output of graph.outputs || []) {
        for (let index = 0; index < argumentValues(output).length; index++) {
            const value = argumentValues(output)[index];
            if (matches(value)) {
                consumers.push({ node: null, argument: output, index, graphOutput: true });
            }
        }
    }
    return consumers;
};

export const collectNodesBetween = (graph, beginNode, endNode) => {
    if (!beginNode || !endNode) {
        throw new SubgraphExtractError('Begin and end nodes are required.');
    }
    if (beginNode === endNode) {
        return new Set([beginNode]);
    }
    const forward = new Set();
    const forwardQueue = [beginNode];
    while (forwardQueue.length > 0) {
        const node = forwardQueue.shift();
        if (forward.has(node)) {
            continue;
        }
        forward.add(node);
        for (const output of node.outputs || []) {
            for (const value of argumentValues(output)) {
                if (!value || !value.name) {
                    continue;
                }
                for (const consumer of findValueConsumers(graph, value)) {
                    if (consumer.node && !forward.has(consumer.node)) {
                        forwardQueue.push(consumer.node);
                    }
                }
            }
        }
    }
    if (!forward.has(endNode)) {
        throw new SubgraphExtractError('End node is not reachable from begin node.');
    }
    const backward = new Set();
    const backwardQueue = [endNode];
    while (backwardQueue.length > 0) {
        const node = backwardQueue.shift();
        if (backward.has(node)) {
            continue;
        }
        backward.add(node);
        for (const input of node.inputs || []) {
            for (const value of argumentValues(input)) {
                if (!value || value.initializer || !value.name) {
                    continue;
                }
                for (const producer of findValueProducers(graph, value)) {
                    if (producer.node && !backward.has(producer.node)) {
                        backwardQueue.push(producer.node);
                    }
                }
            }
        }
    }
    const result = new Set();
    for (const node of forward) {
        if (backward.has(node)) {
            result.add(node);
        }
    }
    if (!result.has(beginNode) || !result.has(endNode)) {
        throw new SubgraphExtractError('No valid path exists between begin and end nodes.');
    }
    return result;
};

const normalizeNodeList = (nodes) => {
    if (!nodes) {
        return [];
    }
    return Array.isArray(nodes) ? nodes.filter(Boolean) : [nodes];
};

const hasInGraphProducer = (graph, node) => {
    for (const input of node.inputs || []) {
        for (const value of argumentValues(input)) {
            if (!value || !value.name || value.initializer) {
                continue;
            }
            for (const producer of findValueProducers(graph, value)) {
                if (producer.node) {
                    return true;
                }
            }
        }
    }
    return false;
};

export const computeNodeLevels = (graph) => {
    const levels = new Map();
    for (const node of graph.nodes || []) {
        if (!hasInGraphProducer(graph, node)) {
            levels.set(node, 0);
        }
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of graph.nodes || []) {
            for (const input of node.inputs || []) {
                for (const value of argumentValues(input)) {
                    if (!value || !value.name || value.initializer) {
                        continue;
                    }
                    for (const producer of findValueProducers(graph, value)) {
                        if (!producer.node) {
                            continue;
                        }
                        const base = levels.get(producer.node);
                        if (base === undefined) {
                            continue;
                        }
                        const next = base + 1;
                        if (!levels.has(node) || levels.get(node) < next) {
                            levels.set(node, next);
                            changed = true;
                        }
                    }
                }
            }
        }
    }
    return levels;
};

const nodeDisplayName = (node) => node.name || (node.type && node.type.name) || 'unknown';

const assertSameLevel = (nodes, levels, label) => {
    const seen = new Set();
    for (const node of nodes) {
        const level = levels.get(node);
        if (level === undefined) {
            throw new SubgraphExtractError(`Could not determine level for ${label.toLowerCase()} node '${nodeDisplayName(node)}'.`);
        }
        seen.add(level);
    }
    if (seen.size > 1) {
        const details = nodes.map((node) => `${nodeDisplayName(node)} (${levels.get(node)})`).join(', ');
        throw new SubgraphExtractError(`${label} nodes must be on the same level: ${details}.`);
    }
};

export const isNodeReachable = (graph, beginNode, endNode) => {
    if (!beginNode || !endNode) {
        return false;
    }
    if (beginNode === endNode) {
        return true;
    }
    const forward = new Set();
    const queue = [beginNode];
    while (queue.length > 0) {
        const node = queue.shift();
        if (forward.has(node)) {
            continue;
        }
        forward.add(node);
        for (const output of node.outputs || []) {
            for (const value of argumentValues(output)) {
                if (!value || !value.name) {
                    continue;
                }
                for (const consumer of findValueConsumers(graph, value)) {
                    if (consumer.node && !forward.has(consumer.node)) {
                        queue.push(consumer.node);
                    }
                }
            }
        }
    }
    return forward.has(endNode);
};

export const validateMarkedRangeNodes = (graph, beginNodes, endNodes) => {
    const begins = normalizeNodeList(beginNodes);
    const ends = normalizeNodeList(endNodes);
    if (begins.length === 0 || ends.length === 0) {
        throw new SubgraphExtractError('At least one begin and one end node are required.');
    }
    // const levels = computeNodeLevels(graph);
    // assertSameLevel(begins, levels, 'Begin');
    // assertSameLevel(ends, levels, 'End');
    // const beginLevel = levels.get(begins[0]);
    // const endLevel = levels.get(ends[0]);
    // if (beginLevel > endLevel) {
    //     throw new SubgraphExtractError('Begin nodes must not be deeper than end nodes.');
    // }
    for (const end of ends) {
        if (!begins.some((begin) => isNodeReachable(graph, begin, end))) {
            throw new SubgraphExtractError(`End node '${nodeDisplayName(end)}' is not reachable from any marked begin node.`);
        }
    }
    for (const begin of begins) {
        if (!ends.some((end) => isNodeReachable(graph, begin, end))) {
            throw new SubgraphExtractError(`Begin node '${nodeDisplayName(begin)}' cannot reach any marked end node.`);
        }
    }
};

export const collectNodesBetweenMulti = (graph, beginNodes, endNodes) => {
    const begins = normalizeNodeList(beginNodes);
    const ends = normalizeNodeList(endNodes);
    validateMarkedRangeNodes(graph, begins, ends);
    const result = new Set();
    for (const begin of begins) {
        for (const end of ends) {
            if (!isNodeReachable(graph, begin, end)) {
                continue;
            }
            for (const node of collectNodesBetween(graph, begin, end)) {
                result.add(node);
            }
        }
    }
    if (result.size === 0) {
        throw new SubgraphExtractError('No valid paths exist between marked begin and end nodes.');
    }
    return result;
};

const cloneExtractValue = (value, valueMap) => {
    if (!value) {
        return null;
    }
    if (valueMap.has(value)) {
        return valueMap.get(value);
    }
    const cloned = {
        name: value.name,
        attributes: (value.attributes || []).map((attribute) => ({
            name: attribute.name,
            type: attribute.type,
            value: cloneAttributeValue(attribute.value)
        }))
    };
    if (value.type !== undefined) {
        cloned.type = value.type;
    }
    if (value.description !== undefined) {
        cloned.description = value.description;
    }
    if (value.initializer !== undefined) {
        cloned.initializer = value.initializer;
    }
    if (value.visible === false) {
        cloned.visible = false;
    }
    valueMap.set(value, cloned);
    return cloned;
};

const cloneExtractNode = (node, valueMap) => ({
    name: node.name,
    type: readType(node.type),
    attributes: (node.attributes || []).map((attribute) => ({
        name: attribute.name,
        type: attribute.type,
        value: cloneAttributeValue(attribute.value)
    })),
    inputs: (node.inputs || []).map((input) => ({
        name: input.name,
        value: argumentValues(input).map((entry) => cloneExtractValue(entry, valueMap)).filter((entry) => entry !== null)
    })),
    outputs: (node.outputs || []).map((output) => ({
        name: output.name,
        value: argumentValues(output).map((entry) => cloneExtractValue(entry, valueMap)).filter((entry) => entry !== null)
    }))
});

export const extractSubgraph = (graph, beginNodes, endNodes) => {
    const begins = normalizeNodeList(beginNodes);
    const ends = normalizeNodeList(endNodes);
    const keepSet = collectNodesBetweenMulti(graph, begins, ends);
    const valueMap = new Map();
    const keptNodes = (graph.nodes || []).filter((node) => keepSet.has(node)).map((node) => cloneExtractNode(node, valueMap));

    const internalNames = new Set();
    for (const node of keptNodes) {
        for (const output of node.outputs || []) {
            for (const value of output.value || []) {
                if (value && value.name) {
                    internalNames.add(value.name);
                }
            }
        }
    }

    const boundaryInputs = new Map();
    for (const node of keptNodes) {
        for (const input of node.inputs || []) {
            for (const value of input.value || []) {
                if (!value || !value.name || value.initializer || internalNames.has(value.name)) {
                    continue;
                }
                if (!boundaryInputs.has(value.name)) {
                    boundaryInputs.set(value.name, {
                        name: value.name,
                        value: [cloneExtractValue(value, valueMap)]
                    });
                }
            }
        }
    }

    const boundaryOutputs = new Map();
    for (const node of keptNodes) {
        for (const output of node.outputs || []) {
            for (const value of output.value || []) {
                if (!value || !value.name || boundaryOutputs.has(value.name)) {
                    continue;
                }
                const consumers = findValueConsumers(graph, value);
                const isBoundary = consumers.some((consumer) => {
                    if (consumer.graphOutput) {
                        return true;
                    }
                    return consumer.node && !keepSet.has(consumer.node);
                });
                if (isBoundary) {
                    boundaryOutputs.set(value.name, {
                        name: value.name,
                        value: [cloneExtractValue(value, valueMap)]
                    });
                }
            }
        }
    }

    if (boundaryOutputs.size === 0) {
        for (const endNode of ends) {
            for (const output of endNode.outputs || []) {
                for (const value of output.value || []) {
                    if (value && value.name && !boundaryOutputs.has(value.name)) {
                        boundaryOutputs.set(value.name, {
                            name: output.name,
                            value: [cloneExtractValue(value, valueMap)]
                        });
                    }
                }
            }
        }
    }

    const orderedInputs = [];
    for (const input of graph.inputs || []) {
        for (const value of argumentValues(input)) {
            if (value && value.name && boundaryInputs.has(value.name)) {
                orderedInputs.push(boundaryInputs.get(value.name));
                boundaryInputs.delete(value.name);
            }
        }
    }
    for (const entry of boundaryInputs.values()) {
        orderedInputs.push(entry);
    }

    const orderedOutputs = [];
    for (const output of graph.outputs || []) {
        for (const value of argumentValues(output)) {
            if (value && value.name && boundaryOutputs.has(value.name)) {
                orderedOutputs.push(boundaryOutputs.get(value.name));
                boundaryOutputs.delete(value.name);
            }
        }
    }
    for (const entry of boundaryOutputs.values()) {
        orderedOutputs.push(entry);
    }

    return {
        name: graph.name,
        identifier: graph.identifier,
        inputs: orderedInputs,
        outputs: orderedOutputs,
        nodes: keptNodes
    };
};

export const buildNodeFromMetadata = (opSchema, uniqueName, graph) => {
    const type = {
        name: opSchema.name,
        identifier: opSchema.name,
        module: opSchema.module || 'ai.onnx',
        version: opSchema.version
    };
    if (Array.isArray(opSchema.attributes)) {
        type.attributes = opSchema.attributes.map((entry) => ({
            name: entry.name,
            type: entry.type,
            default: entry.default,
            required: entry.required
        }));
    }
    const attributes = (opSchema.attributes || [])
        .filter((entry) => entry.default !== undefined)
        .map((entry) => ({
            name: entry.name,
            type: entry.type,
            value: cloneAttributeValue(entry.default)
        }));
    const schemaInputs = Array.isArray(opSchema.inputs) ? opSchema.inputs : [];
    const schemaOutputs = Array.isArray(opSchema.outputs) ? opSchema.outputs : [];
    const minInputs = opSchema.min_input !== undefined ? opSchema.min_input : Math.max(schemaInputs.length, 1);
    const minOutputs = opSchema.min_output !== undefined ? opSchema.min_output : Math.max(schemaOutputs.length, 1);
    const inputs = [];
    for (let index = 0; index < Math.max(schemaInputs.length, minInputs); index++) {
        const schema = schemaInputs[index];
        inputs.push({
            name: schema ? schema.name : `input_${index}`,
            value: []
        });
    }
    const outputs = [];
    for (let index = 0; index < Math.max(schemaOutputs.length, minOutputs); index++) {
        const schema = schemaOutputs[index];
        outputs.push({
            name: schema ? schema.name : `output_${index}`,
            value: []
        });
    }
    return {
        name: uniqueName || genUniqueNodeName(`Inserted${opSchema.name}`, graph),
        type,
        attributes,
        inputs,
        outputs,
        min_input: opSchema.min_input !== undefined ? opSchema.min_input : minInputs,
        max_input: opSchema.max_input !== undefined ? opSchema.max_input : Math.max(schemaInputs.length, minInputs),
        min_output: opSchema.min_output !== undefined ? opSchema.min_output : minOutputs,
        max_output: opSchema.max_output !== undefined ? opSchema.max_output : Math.max(schemaOutputs.length, minOutputs),
        inputSchemas: schemaInputs.map((entry) => ({
            name: entry.name,
            list: entry.list === true,
            option: entry.option
        }))
    };
};

const isFixedArityWiring = (nodeSpec) => {
    const schemas = nodeSpec.inputSchemas || [];
    if (schemas.some((entry) => entry.list)) {
        return false;
    }
    const min = nodeSpec.min_input;
    const max = nodeSpec.max_input !== undefined ? nodeSpec.max_input : min;
    return min !== undefined && max !== undefined && min === max && min > 0;
};

const isVariadicListInput = (nodeSpec) => {
    const schemas = nodeSpec.inputSchemas || [];
    return schemas.length === 1 && schemas[0].list === true;
};

const flattenDynamicTensors = (spliceTargets) => {
    const tensors = [];
    for (const target of spliceTargets) {
        if (!target || !Array.isArray(target.input.value)) {
            continue;
        }
        for (const value of target.input.value) {
            if (value) {
                tensors.push(value);
            }
        }
    }
    return tensors;
};

const flattenOutputTensors = (refOutputs) => {
    const tensors = [];
    for (const refOutput of refOutputs) {
        if (!refOutput || !Array.isArray(refOutput.value)) {
            continue;
        }
        for (const value of refOutput.value) {
            if (value) {
                tensors.push(value);
            }
        }
    }
    return tensors;
};

const buildPlannedInputs = (nodeSpec, inputCount, sourceTensors, perSlotSources) => {
    const schemaInputs = nodeSpec.inputs || [];
    const inputs = [];
    if (isVariadicListInput(nodeSpec)) {
        for (let index = 0; index < inputCount; index++) {
            const schemaInput = schemaInputs[index];
            inputs.push({
                name: schemaInput ? schemaInput.name : `input_${index}`,
                value: index === 0 ? sourceTensors.slice() : []
            });
        }
        return inputs;
    }
    if (isFixedArityWiring(nodeSpec) && inputCount > 1) {
        for (let index = 0; index < inputCount; index++) {
            const schemaInput = schemaInputs[index];
            inputs.push({
                name: schemaInput ? schemaInput.name : `input_${index}`,
                value: index < sourceTensors.length ? [sourceTensors[index]] : []
            });
        }
        return inputs;
    }
    for (let index = 0; index < inputCount; index++) {
        const schemaInput = schemaInputs[index];
        const source = perSlotSources[index];
        let inputValues = source && Array.isArray(source) ? source.slice() : [];
        if (inputCount === 1 && inputValues.length > 1) {
            inputValues = [inputValues[0]];
        }
        inputs.push({
            name: schemaInput ? schemaInput.name : `input_${index}`,
            value: inputValues
        });
    }
    return inputs;
};

// treats an argument as static when every value has an initializer
// meaning that the value is not dynamic and can be used as a static input
const isStaticInput = (argument) => {
    if (!argument || !Array.isArray(argument.value) || argument.value.length === 0) {
        return false;
    }
    return argument.value.every((value) => value && value.initializer);
};

export const planNodeInsert = (graph, refNodeIndex, position, nodeSpec) => {
    const nodes = graph.nodes || [];
    const refNode = nodes[refNodeIndex];
    if (!refNode) {
        throw new Error(`Reference node at index ${refNodeIndex} not found`);
    }
    if (position !== 'above' && position !== 'below') {
        throw new Error(`Invalid insert position: ${position}`);
    }
    const schemaInputs = nodeSpec.inputs || [];
    const schemaOutputs = nodeSpec.outputs || [];
    const minInputs = nodeSpec.min_input !== undefined ? nodeSpec.min_input : Math.max(schemaInputs.length, 1);
    const minOutputs = nodeSpec.min_output !== undefined ? nodeSpec.min_output : Math.max(schemaOutputs.length, 1);
    const inputs = [];
    let outputCount = 1;
    let spliceTargets = [];
    if (position === 'above') {
        const refInputs = refNode.inputs || [];
        const inputCount = Math.max(schemaInputs.length, minInputs);
        outputCount = Math.max(schemaOutputs.length, minOutputs);
        for (let index = 0; index < refInputs.length; index++) {
            const refInput = refInputs[index];
            if (!isStaticInput(refInput)) {
                spliceTargets.push({ index, input: refInput });
            }
        }
        const spliceLimit = Math.min(spliceTargets.length, inputCount);
        const perSlotSources = [];
        for (let index = 0; index < inputCount; index++) {
            const spliceTarget = index < spliceLimit ? spliceTargets[index] : null;
            perSlotSources.push(spliceTarget && Array.isArray(spliceTarget.input.value) ?
                spliceTarget.input.value : []);
        }
        inputs.push(...buildPlannedInputs(
            nodeSpec,
            inputCount,
            flattenDynamicTensors(spliceTargets),
            perSlotSources
        ));
    } else {
        const refOutputs = refNode.outputs || [];
        const inputCount = Math.max(refOutputs.length, schemaInputs.length, 1);
        outputCount = Math.max(schemaOutputs.length, refOutputs.length, 1);
        const perSlotSources = refOutputs.map((refOutput) => (
            refOutput && Array.isArray(refOutput.value) ? refOutput.value : []
        ));
        while (perSlotSources.length < inputCount) {
            perSlotSources.push([]);
        }
        const planned = buildPlannedInputs(
            nodeSpec,
            inputCount,
            flattenOutputTensors(refOutputs),
            perSlotSources
        );
        for (let index = 0; index < inputCount; index++) {
            const refOutput = refOutputs[index];
            const schemaInput = schemaInputs[index];
            planned[index].name = schemaInput ? schemaInput.name :
                (refOutput ? refOutput.name : `input_${index}`);
        }
        inputs.push(...planned);
    }
    return { refNode, position, inputs, outputCount, spliceTargets };
};

export const insertNode = (graph, refNodeIndex, position, nodeSpec) => {
    const nodes = graph.nodes || [];
    const refNode = nodes[refNodeIndex];
    const prefix = nodeSpec.name || 'inserted';
    const plan = planNodeInsert(graph, refNodeIndex, position, nodeSpec);
    const schemaOutputs = nodeSpec.outputs || [];
    const newNode = {
        name: nodeSpec.name,
        type: nodeSpec.type,
        attributes: (nodeSpec.attributes || []).map((attribute) => ({
            name: attribute.name,
            type: attribute.type,
            value: cloneAttributeValue(attribute.value)
        })),
        inputs: plan.inputs.map((input) => ({
            name: input.name,
            value: input.value.slice()
        })),
        outputs: []
    };
    const newOutputValues = [];
    for (let index = 0; index < plan.outputCount; index++) {
        const schemaOutput = schemaOutputs[index];
        const tensorName = genUniqueTensorName(`${prefix}_out_${index}`, graph);
        const newValue = { name: tensorName, attributes: [] };
        newOutputValues.push(newValue);
        newNode.outputs.push({
            name: schemaOutput ? schemaOutput.name : `output_${index}`,
            value: [newValue]
        });
    }
    if (position === 'above') {
        const refInputs = refNode.inputs || [];
        const rewireLimit = Math.min(plan.spliceTargets.length, plan.outputCount);
        for (let index = 0; index < rewireLimit; index++) {
            const { index: refIndex } = plan.spliceTargets[index];
            const newValue = newOutputValues[Math.min(index, newOutputValues.length - 1)];
            if (newValue && refInputs[refIndex]) {
                refInputs[refIndex].value = [newValue];
            }
        }
    } else {
        const refOutputs = refNode.outputs || [];
        const oldOutputValues = refOutputs.map((output) => (
            Array.isArray(output.value) && output.value.length > 0 ? output.value[0] : null
        ));
        for (let index = 0; index < oldOutputValues.length; index++) {
            const oldValue = oldOutputValues[index];
            const newValue = newOutputValues[Math.min(index, newOutputValues.length - 1)];
            if (!oldValue || !newValue) {
                continue;
            }
            const consumers = findValueConsumers(graph, oldValue);
            for (const consumer of consumers) {
                if (consumer.node === newNode) {
                    continue;
                }
                consumer.argument.value[consumer.index] = newValue;
            }
        }
    }
    const insertIndex = position === 'above' ? refNodeIndex : refNodeIndex + 1;
    nodes.splice(insertIndex, 0, newNode);
    if (!graph.nodes) {
        graph.nodes = nodes;
    }
    return { insertIndex, node: newNode };
};

export class NodeDeleteError extends Error {

    constructor(message) {
        super(message);
        this.name = 'NodeDeleteError';
    }
}

const tensorAt = (args, index) => {
    const argument = args[index];
    if (!argument || !Array.isArray(argument.value) || argument.value.length === 0) {
        return null;
    }
    return argument.value[0];
};

const inputTensorAt = (node, index) => tensorAt(node.inputs || [], index);

const outputTensorAt = (node, index) => tensorAt(node.outputs || [], index);

const dataInputTensors = (node) => {
    const inputSlots = (node.inputs || []).length > 0 ? node.inputs.length : 1;
    const tensors = [];
    for (let index = 0; index < inputSlots; index++) {
        const tensor = inputTensorAt(node, index);
        if (tensor && !tensor.initializer) {
            tensors.push(tensor);
        }
    }
    return tensors;
};

const primaryDataInput = (node) => {
    const tensors = dataInputTensors(node);
    return tensors.length > 0 ? tensors[0] : null;
};

const bypassInputForOutput = (node, outputIndex) => {
    const dataInputs = dataInputTensors(node);
    if (dataInputs.length === 0) {
        return null;
    }
    const outputSlots = (node.outputs || []).length > 0 ? node.outputs.length : 1;
    if (outputSlots === dataInputs.length) {
        return dataInputs[outputIndex] || dataInputs[0];
    }
    return dataInputs[0];
};

export const cloneGraphModules = (modules) => readModel({ format: '', modules }).modules;

export const cloneGraph = (graph) => cloneGraphModules([graph])[0];

export const findDanglingNodes = (graph) => {
    const dangling = [];
    const graphOutputNames = new Set();
    for (const output of graph.outputs || []) {
        for (const value of argumentValues(output)) {
            if (value && value.name) {
                graphOutputNames.add(value.name);
            }
        }
    }
    for (const node of graph.nodes || []) {
        const outputs = node.outputs || [];
        if (outputs.length === 0) {
            continue;
        }
        let allUnused = true;
        for (const output of outputs) {
            for (const value of argumentValues(output)) {
                if (!value || !value.name) {
                    continue;
                }
                if (graphOutputNames.has(value.name)) {
                    allUnused = false;
                    break;
                }
                if (findValueConsumers(graph, value).length > 0) {
                    allUnused = false;
                    break;
                }
            }
            if (!allUnused) {
                break;
            }
        }
        if (allUnused) {
            dangling.push(node);
        }
    }
    return dangling;
};

const rewireAndRemoveNode = (graph, nodeIndex) => {
    const nodes = graph.nodes || [];
    const node = nodes[nodeIndex];
    const outputSlots = (node.outputs || []).length > 0 ? node.outputs.length : 1;
    const rewiredPairs = [];
    for (let index = 0; index < outputSlots; index++) {
        const outputValue = outputTensorAt(node, index);
        if (!outputValue) {
            continue;
        }
        const bypass = bypassInputForOutput(node, index);
        if (!bypass) {
            continue;
        }
        const consumers = findValueConsumers(graph, outputValue);
        for (const consumer of consumers) {
            if (consumer.node === node) {
                continue;
            }
            consumer.argument.value[consumer.index] = bypass;
        }
        rewiredPairs.push({ from: outputValue, to: bypass });
    }
    const deleted = nodes.splice(nodeIndex, 1)[0];
    return { deletedIndex: nodeIndex, node: deleted, rewiredPairs };
};

export const analyzeDeleteNode = (graph, node) => {
    // this analyzes the node and returns a list of warnings based on inputs and outputs
    const warnings = [];
    if (!graph || !node) {
        return { ok: false, blockReason: 'Node not found.', warnings, needsConfirm: false };
    }
    const inputs = node.inputs || [];
    const hasInitializerInputs = inputs.some((_, index) => {
        const tensor = inputTensorAt(node, index);
        return tensor && tensor.initializer;
    });
    if (hasInitializerInputs) {
        warnings.push({
            code: 'WEIGHTS_IGNORED',
            level: 'info',
            message: 'Weight and bias inputs will be disconnected.'
        });
    }
    const dataInputs = dataInputTensors(node);
    if (dataInputs.length === 0) {
        return {
            ok: false,
            blockReason: 'Cannot delete a node with no data inputs to bypass from.',
            warnings,
            needsConfirm: false
        };
    }
    const distinctDataNames = new Set(dataInputs.map((tensor) => tensor.name).filter(Boolean));
    if (distinctDataNames.size > 1) {
        warnings.push({
            code: 'MERGE_NODE',
            level: 'warning',
            message: 'Only the first data input path will be kept; other branches may become unused.'
        });
    }
    const outputSlots = (node.outputs || []).length > 0 ? node.outputs.length : 1;
    if (outputSlots > 1) {
        warnings.push({
            code: 'MULTI_OUTPUT',
            level: 'warning',
            message: 'All outputs will be rewired to the corresponding data input (or the primary input).'
        });
    }
    const nodeIndex = (graph.nodes || []).indexOf(node);
    let predictedDangling = [];
    if (nodeIndex >= 0) {
        try {
            const cloned = cloneGraph(graph);
            rewireAndRemoveNode(cloned, nodeIndex);
            predictedDangling = findDanglingNodes(cloned);
        } catch {
            predictedDangling = [];
        }
    }
    if (predictedDangling.length > 0) {
        warnings.push({
            code: 'DANGLING_PREDICTED',
            level: 'warning',
            message: `${predictedDangling.length} node${predictedDangling.length === 1 ? '' : 's'} may become unused (highlighted after delete).`,
            nodes: predictedDangling
        });
    }
    return {
        ok: true,
        warnings,
        needsConfirm: warnings.some((entry) => entry.level === 'warning')
    };
};

export const canDeleteNode = (graph, node) => {
    const analysis = analyzeDeleteNode(graph, node);
    return {
        ok: analysis.ok,
        reason: analysis.blockReason || ''
    };
};

export const deleteNode = (graph, nodeIndex) => {
    const nodes = graph.nodes || [];
    const node = nodes[nodeIndex];
    if (!node) {
        throw new NodeDeleteError(`Node at index ${nodeIndex} not found.`);
    }
    const analysis = analyzeDeleteNode(graph, node);
    if (!analysis.ok) {
        throw new NodeDeleteError(analysis.blockReason);
    }
    const result = rewireAndRemoveNode(graph, nodeIndex);
    result.danglingNodes = findDanglingNodes(graph);
    return result;
};

// This builds a picture of the old graph
// essentially, this works by iterating through the graph and adding the nodes and attributes to the snapshot
const buildOriginalSnapshot = (model) => {
    const snapshot = new Map();
    model.modules.forEach((graph, graphIndex) => {
        graph.nodes.forEach((node, nodeIndex) => {
            const nodeId = `graph:${graphIndex}/node:${nodeIndex}`;
            snapshot.set(nodeId, node.name);
            node.attributes.forEach((attribute, attributeIndex) => {
                const attributeId = `${nodeId}/attr:${attributeIndex}`;
                let snapshotValue = cloneAttributeValue(attribute.value);
                if (model._ambapb && isAmbapbShellNode(node) && attribute.name === PRIM_GRAPH_ATTRIBUTE) {
                    snapshotValue = getPrimGraphSnapshotValue(model._ambapb);
                }
                snapshot.set(attributeId, snapshotValue);
            });
        });
        for (const [value, valueId] of enumerateGraphValues(graph, graphIndex)) {
            snapshot.set(`${valueId}:name`, value.name);
            if (value.type !== undefined) {
                snapshot.set(`${valueId}:type`, value.type);
            }
            if (value.description !== undefined) {
                snapshot.set(`${valueId}:description`, value.description);
            }
            (value.attributes || []).forEach((attribute, attributeIndex) => {
                const attributeId = `${valueId}/attr:${attributeIndex}`;
                snapshot.set(attributeId, cloneAttributeValue(attribute.value));
            });
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

    validateNameOnTarget(target, attributeName, excludeIndex = -1, reserved = []) {
        if (!attributeName) {
            return 'Attribute name is required';
        }
        if (reserved.includes(attributeName)) {
            return `Property '${attributeName}' is reserved`;
        }
        const attributes = target.attributes || [];
        for (let index = 0; index < attributes.length; index++) {
            if (index !== excludeIndex && attributes[index].name === attributeName) {
                return `Attribute '${attributeName}' already exists`;
            }
        }
        return null;
    },

    validateName(node, attributeName, excludeIndex = -1) {
        return this.validateNameOnTarget(node, attributeName, excludeIndex);
    },

    validateValuePropertyName(value, propertyName, excludeIndex = -1) {
        return this.validateNameOnTarget(value, propertyName, excludeIndex, ['name', 'type', 'description']);
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
        if (original._ambapb) {
            attachAmbapbEditingState(normalized, original._ambapb);
        }
        this.modified = new EditableModel(normalized);
        this._snapshot = buildOriginalSnapshot(normalized);
        this.delta = new DeltaTracker(this._snapshot);
        this.history = new EditHistory();
        this.batchInlineExpanded = [];
    }

    get original() {
        return this._original;
    }

    replaceGraph(graphIndex, newGraph) {
        this.modified.model.modules[graphIndex] = newGraph;
        this._snapshot = buildOriginalSnapshot(this.modified.model);
        this.delta = new DeltaTracker(this._snapshot);
    }

    applyPatch(patch) {
        let entityId = patch.entityId;
        let changeType = patch.changeType;
        let newValueForDelta = patch.newValue;
        validateAmbapbPatch(this.modified.model, patch);

        if (patch.changeType === 'add' && patch.entityType === 'attribute') {
            const location = parseAttributeParentId(patch.parentId);
            const target = getAttributeTarget(this.modified.model, location);
            const name = attributeNameFromProperty(patch.property);
            const attributeType = patch.attributeType || (
                location.target === 'node' ?
                    AttributeSchemaResolver.resolveType(target.type, name) :
                    AttributeSchemaResolver.resolveType(null, name)
            );
            if (!Array.isArray(target.attributes)) {
                target.attributes = [];
            }
            target.attributes.push({
                name,
                type: attributeType,
                value: Array.isArray(patch.newValue) ? patch.newValue.slice() : patch.newValue
            });
            entityId = `${patch.parentId}/attr:${target.attributes.length - 1}`;
        } else if (patch.changeType === 'delete' && patch.entityType === 'attribute') {
            const location = parseAttributeEntityId(entityId);
            const target = getAttributeTarget(this.modified.model, location);
            target.attributes.splice(location.attributeIndex, 1);
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
        } else if (patch.entityType === 'attribute') {
            const location = parseAttributeEntityId(entityId);
            const target = getAttributeTarget(this.modified.model, location);
            const attribute = target.attributes[location.attributeIndex];
            attribute.value = Array.isArray(patch.newValue) ? patch.newValue.slice() : patch.newValue;
            if (location.target === 'node' && this.modified.model._ambapb) {
                syncShellAttribute(
                    this.modified.model,
                    location.graphIndex,
                    location.targetIndex,
                    attribute.name,
                    patch.newValue
                );
                if (this._original._ambapb) {
                    syncShellAttribute(
                        { modules: this.modified.model.modules, _ambapb: this._original._ambapb },
                        location.graphIndex,
                        location.targetIndex,
                        attribute.name,
                        patch.newValue
                    );
                }
                if (attribute.name === PRIM_GRAPH_ATTRIBUTE) {
                    newValueForDelta = getPrimGraphSnapshotValue(this.modified.model._ambapb);
                }
            }
        } else if (patch.changeType === 'add' && patch.entityType === 'node' && patch.property === 'insert') {
            const location = parseNodeEntityId(patch.parentId);
            const graph = this.modified.getGraph(location.graphIndex);
            const position = patch.position;
            const { insertIndex } = insertNode(graph, location.nodeIndex, position, patch.newValue);
            this.delta.remapNodeIndices(location.graphIndex, insertIndex, 1);
            entityId = `graph:${location.graphIndex}/node:${insertIndex}`;
            changeType = 'add';
        } else if (patch.changeType === 'delete' && patch.entityType === 'node' && patch.property === 'remove') {
            const location = parseNodeEntityId(entityId);
            const graph = this.modified.getGraph(location.graphIndex);
            const wasAdded = this.delta.getState(entityId) === 'added';
            deleteNode(graph, location.nodeIndex);
            this.delta.remapNodeIndices(location.graphIndex, location.nodeIndex + 1, -1);
            changeType = 'delete';
            if (wasAdded) {
                this.delta.clearEntity(entityId);
                return {
                    entityId,
                    entityType: patch.entityType,
                    changeType,
                    property: patch.property,
                    oldValue: undefined,
                    newValue: patch.newValue
                };
            }
        } else {
            const nestedLocation = parseNestedCompiledNodeEntityId(entityId);
            let node = null;

            if (nestedLocation && nestedLocation.attributeIndex === null) {
                const resolved = getNestedCompiledGraphNode(this.modified.model, nestedLocation);
                node = resolved ? resolved.node : null;
            } else if (!nestedLocation) {
                const location = parseNodeEntityId(entityId.includes('/attr:') ? entityId : patch.parentId || entityId);
                const graph = this.modified.getGraph(location.graphIndex);
                node = graph.nodes[location.nodeIndex];
            }

            if (!node) {
                throw new Error(`Node not found for entityId: ${entityId}`);
            }

            if (patch.entityType === 'node' && patch.property === 'name') {
                node.name = patch.newValue;
            } else if (patch.entityType === 'node' && patch.property === 'description') {
                node.description = patch.newValue;
            } else {
                throw new Error(`Unsupported patch: ${JSON.stringify(patch)}`);
            }
        }

        const change = {
            entityId,
            entityType: patch.entityType,
            changeType,
            property: patch.property,
            newValue: newValueForDelta
        };
        if (patch.parentId) {
            change.parentId = patch.parentId;
        }
        if (patch.position) {
            change.position = patch.position;
        }
        this.delta.record(change);
        const recorded = this.delta.getChanges().find((entry) => entry.entityId === entityId);
        return recorded || {
            entityId,
            entityType: patch.entityType,
            changeType,
            property: patch.property,
            oldValue: undefined,
            newValue: newValueForDelta
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
        for (let hostNodeIndex = 0; hostNodeIndex < nodes.length; hostNodeIndex++) {
            for (const entry of nodeGraphArguments(nodes[hostNodeIndex])) {
                if (entry.type !== 'graph' || !entry.value || !Array.isArray(entry.value.nodes)) {
                    continue;
                }
                const subNodeIndex = entry.value.nodes.indexOf(node);
                if (subNodeIndex >= 0) {
                    return {
                        graphIndex,
                        nodeIndex: subNodeIndex,
                        nodeId: `graph:${graphIndex}/node:${hostNodeIndex}/${entry.name}/node:${subNodeIndex}`,
                        nested: true,
                        hostNodeIndex,
                        graphAttrName: entry.name
                    };
                }
            }
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
