
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

const parseAttributeEntityId = (entityId) => {
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
    const levels = computeNodeLevels(graph);
    assertSameLevel(begins, levels, 'Begin');
    assertSameLevel(ends, levels, 'End');
    const beginLevel = levels.get(begins[0]);
    const endLevel = levels.get(ends[0]);
    if (beginLevel > endLevel) {
        throw new SubgraphExtractError('Begin nodes must not be deeper than end nodes.');
    }
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
                        name: input.name,
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
                        name: output.name,
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
        outputs
    };
};

export const insertNode = (graph, refNodeIndex, position, nodeSpec) => {
    const nodes = graph.nodes || [];
    const refNode = nodes[refNodeIndex];
    if (!refNode) {
        throw new Error(`Reference node at index ${refNodeIndex} not found`);
    }
    if (position !== 'above' && position !== 'below') {
        throw new Error(`Invalid insert position: ${position}`);
    }
    const prefix = nodeSpec.name || 'inserted';
    const newNode = {
        name: nodeSpec.name,
        type: nodeSpec.type,
        attributes: (nodeSpec.attributes || []).map((attribute) => ({
            name: attribute.name,
            type: attribute.type,
            value: cloneAttributeValue(attribute.value)
        })),
        inputs: [],
        outputs: []
    };
    if (position === 'above') {
        const refInputs = refNode.inputs || [];
        const inputCount = Math.max(refInputs.length, (nodeSpec.inputs || []).length, 1);
        for (let index = 0; index < inputCount; index++) {
            const refInput = refInputs[index];
            const schemaInput = (nodeSpec.inputs || [])[index];
            const inputValues = refInput && Array.isArray(refInput.value) ? refInput.value.slice() : [];
            newNode.inputs.push({
                name: schemaInput ? schemaInput.name : (refInput ? refInput.name : `input_${index}`),
                value: inputValues
            });
        }
        const outputCount = Math.max((nodeSpec.outputs || []).length, refInputs.length, 1);
        for (let index = 0; index < outputCount; index++) {
            const schemaOutput = (nodeSpec.outputs || [])[index];
            const tensorName = genUniqueTensorName(`${prefix}_out_${index}`, graph);
            const newValue = { name: tensorName, attributes: [] };
            newNode.outputs.push({
                name: schemaOutput ? schemaOutput.name : `output_${index}`,
                value: [newValue]
            });
            if (index < refInputs.length && refInputs[index]) {
                refInputs[index].value = [newValue];
            }
        }
    } else {
        const refOutputs = refNode.outputs || [];
        const inputCount = Math.max(refOutputs.length, (nodeSpec.inputs || []).length, 1);
        for (let index = 0; index < inputCount; index++) {
            const refOutput = refOutputs[index];
            const schemaInput = (nodeSpec.inputs || [])[index];
            const inputValues = refOutput && Array.isArray(refOutput.value) ? refOutput.value.slice() : [];
            newNode.inputs.push({
                name: schemaInput ? schemaInput.name : (refOutput ? refOutput.name : `input_${index}`),
                value: inputValues
            });
        }
        const outputCount = Math.max((nodeSpec.outputs || []).length, refOutputs.length, 1);
        const oldOutputValues = refOutputs.map((output) => (
            Array.isArray(output.value) && output.value.length > 0 ? output.value[0] : null
        ));
        const newOutputValues = [];
        for (let index = 0; index < outputCount; index++) {
            const schemaOutput = (nodeSpec.outputs || [])[index];
            const tensorName = genUniqueTensorName(`${prefix}_out_${index}`, graph);
            const newValue = { name: tensorName, attributes: [] };
            newOutputValues.push(newValue);
            newNode.outputs.push({
                name: schemaOutput ? schemaOutput.name : `output_${index}`,
                value: [newValue]
            });
        }
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

const bypassInputForOutput = (node, outputIndex) => {
    const inputSlots = (node.inputs || []).length > 0 ? node.inputs.length : 1;
    const outputSlots = (node.outputs || []).length > 0 ? node.outputs.length : 1;
    if (outputSlots === 1 && inputSlots === 1) {
        return inputTensorAt(node, 0);
    }
    if (outputSlots === inputSlots) {
        return inputTensorAt(node, outputIndex);
    }
    if (outputSlots === 1 && inputSlots > 1) {
        return inputTensorAt(node, 0);
    }
    return null;
};

export const canDeleteNode = (graph, node) => {
    if (!graph || !node) {
        return { ok: false, reason: 'Node not found.' };
    }
    const inputs = node.inputs || [];
    const outputs = node.outputs || [];
    const inputSlots = inputs.length > 0 ? inputs.length : 1;
    const outputSlots = outputs.length > 0 ? outputs.length : 1;
    if (!inputTensorAt(node, 0) && inputSlots === 1) {
        return { ok: false, reason: 'Cannot delete a node with no inputs to bypass from.' };
    }
    if (outputSlots === 1 && inputSlots === 1) {
        return inputTensorAt(node, 0) ?
            { ok: true } :
            { ok: false, reason: 'Cannot delete a node with no inputs to bypass from.' };
    }
    if (outputSlots === inputSlots) {
        for (let index = 0; index < outputSlots; index++) {
            if (!inputTensorAt(node, index)) {
                return { ok: false, reason: `Cannot delete node: input ${index} is missing a tensor.` };
            }
        }
        return { ok: true };
    }
    if (outputSlots === 1 && inputSlots > 1) {
        const first = inputTensorAt(node, 0);
        if (!first) {
            return { ok: false, reason: 'Cannot delete a node with no inputs to bypass from.' };
        }
        const firstName = first.name;
        for (let index = 1; index < inputSlots; index++) {
            const tensor = inputTensorAt(node, index);
            if (tensor && tensor.name !== firstName) {
                return {
                    ok: false,
                    reason: 'Cannot delete node: multiple different inputs cannot be bypassed to a single output.'
                };
            }
        }
        return { ok: true };
    }
    return { ok: false, reason: 'Cannot delete node: input and output counts cannot be rewired safely.' };
};

export const deleteNode = (graph, nodeIndex) => {
    const nodes = graph.nodes || [];
    const node = nodes[nodeIndex];
    if (!node) {
        throw new NodeDeleteError(`Node at index ${nodeIndex} not found.`);
    }
    const check = canDeleteNode(graph, node);
    if (!check.ok) {
        throw new NodeDeleteError(check.reason);
    }
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
                snapshot.set(attributeId, cloneAttributeValue(attribute.value));
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
        this.modified = new EditableModel(normalized);
        this._snapshot = buildOriginalSnapshot(normalized);
        this.delta = new DeltaTracker(this._snapshot);
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
            deleteNode(graph, location.nodeIndex);
            this.delta.remapNodeIndices(location.graphIndex, location.nodeIndex + 1, -1);
            changeType = 'delete';
        } else {
            const location = parseNodeEntityId(entityId.includes('/attr:') ? entityId : patch.parentId || entityId);
            const graph = this.modified.getGraph(location.graphIndex);
            const node = graph.nodes[location.nodeIndex];

            if (patch.entityType === 'node' && patch.property === 'name') {
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
