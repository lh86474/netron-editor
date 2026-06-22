/*
 * View-layer inline expansion of BatchCall nodes into their FragSubgraph bodies.
 * We resolve the target subgraph through the graph_id attribute
 * WE parse the mappings for src_mappings and out_mappings
 * We build the display graph here as well
 * Author: Luray He
 */
import { cloneGraph } from './model-editor.js';

const BATCH_CALL_OP = 'BatchCall';
const FRAG_SUBGRAPH_OP = 'FragSubgraph';
const COMPILED_PRIM_GRAPH_ATTR = 'compiled_prim_graph';
const FRAG_SUBGRAPH_GRAPH_ATTR = 'graph';

export class BatchCallInlineError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BatchCallInlineError';
    }
}

const argumentValues = (argument) => {
    if (!argument || argument.value === null || argument.value === undefined) {
        return [];
    }
    return Array.isArray(argument.value) ? argument.value : [argument.value];
};

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

const cloneAttributeValue = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => (typeof item === 'bigint' ? item.toString() : item));
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
};

const graphArguments = (node) => {
    if (!node) {
        return [];
    }
    return (node.attributes || []).concat(node.blocks || []);
};

const getNodeAttribute = (node, name) => {
    return graphArguments(node).find((entry) => entry.name === name) || null;
};

const normalizeGraphId = (value) => {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'bigint' || typeof value === 'number') {
        return String(value);
    }
    if (Array.isArray(value) && value.length > 0) {
        return normalizeGraphId(value[0]);
    }
    return String(value).trim();
};

const mappingEntryId = (entry) => {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    return entry.id || entry.name || null;
};

// batch call has attributes to describe how I/O connect to the subgraph
// handle JSON strings. Each entry uses id
export const parseMappingAttribute = (attribute) => {
    if (!attribute || attribute.value === null || attribute.value === undefined) {
        return [];
    }
    let value = attribute.value;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    return Array.isArray(value) ? value : [];
};

const findGraphByName = (graph, name) => {
    if (!graph || !name) {
        return null;
    }
    if (graph.name === name) {
        return graph;
    }
    for (const node of graph.nodes || []) {
        for (const entry of graphArguments(node)) {
            if (entry.type === 'graph' && entry.value) {
                const found = findGraphByName(entry.value, name);
                if (found) {
                    return found;
                }
            }
        }
    }
    return null;
};

const getCompiledGraphFromNode = (node) => {
    if (!node) {
        return null;
    }
    const attrNames = node.type?.name === FRAG_SUBGRAPH_OP
        ? [COMPILED_PRIM_GRAPH_ATTR, FRAG_SUBGRAPH_GRAPH_ATTR]
        : [COMPILED_PRIM_GRAPH_ATTR];
    for (const name of attrNames) {
        for (const entry of graphArguments(node)) {
            if (entry.name === name && entry.type === 'graph' && entry.value) {
                return entry.value;
            }
        }
    }
    return null;
};

const graphIdMatches = (rootGraph, graphId) => {
    if (!rootGraph || !graphId) {
        return null;
    }
    if (rootGraph.name === graphId) {
        return rootGraph;
    }
    const byName = findGraphByName(rootGraph, graphId);
    if (byName) {
        return byName;
    }
    if (rootGraph.name && (rootGraph.name.endsWith(graphId) || graphId.endsWith(rootGraph.name))) {
        return rootGraph;
    }
    return null;
};

const findBatchCallTargetInNode = (hostNode, graphId) => {
    const compiled = getCompiledGraphFromNode(hostNode);
    if (!compiled) {
        return null;
    }
    const subGraph = graphIdMatches(compiled, graphId);
    if (!subGraph) {
        return null;
    }
    return {
        fragSubgraphNode: hostNode,
        subGraph,
        graphId
    };
};

// This is the lookup step
// confirm node is batchcall, read graph_id, scan sibling nodes for frag subgraph
export const resolveBatchCallTarget = (graph, batchCallNode) => {
    if (!graph || !batchCallNode || batchCallNode.type?.name !== BATCH_CALL_OP) {
        return null;
    }
    const graphIdAttr = getNodeAttribute(batchCallNode, 'graph_id');
    const graphId = normalizeGraphId(graphIdAttr ? graphIdAttr.value : null);
    if (!graphId) {
        return null;
    }
    for (const node of graph.nodes || []) {
        if (node.type?.name !== FRAG_SUBGRAPH_OP) {
            continue;
        }
        const target = findBatchCallTargetInNode(node, graphId);
        if (target) {
            return target;
        }
    }
    for (const node of graph.nodes || []) {
        if (node.type?.name === FRAG_SUBGRAPH_OP) {
            continue;
        }
        const target = findBatchCallTargetInNode(node, graphId);
        if (target) {
            return target;
        }
    }
    return null;
};

export const canExpandBatchCall = (graph, batchCallNode) => {
    return resolveBatchCallTarget(graph, batchCallNode) !== null;
};

export const inlineExpansionBatchCallName = (node) => {
    if (!node || !node.name) {
        return null;
    }
    const match = /^inline::([^:]+)::/.exec(node.name);
    return match ? match[1] : null;
};

const collectSubgraphBoundaryNames = (subGraph) => {
    const names = new Set();
    for (const input of subGraph.inputs || []) {
        if (input.name) {
            names.add(input.name);
        }
        for (const value of argumentValues(input)) {
            if (value && value.name) {
                names.add(value.name);
            }
        }
    }
    for (const output of subGraph.outputs || []) {
        if (output.name) {
            names.add(output.name);
        }
        for (const value of argumentValues(output)) {
            if (value && value.name) {
                names.add(value.name);
            }
        }
    }
    return names;
};

const cloneValue = (value, prefix, valueMap, nameMap) => {
    if (!value) {
        return null;
    }
    if (valueMap.has(value)) {
        return valueMap.get(value);
    }
    const cloned = { name: `${prefix}${value.name}` };
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
    nameMap.set(value.name, cloned);
    return cloned;
};

const cloneNode = (node, prefix, valueMap, nameMap) => {
    const cloneArgument = (argument) => ({
        name: argument.name,
        value: argumentValues(argument)
            .map((entry) => cloneValue(entry, prefix, valueMap, nameMap))
            .filter((entry) => entry !== null)
    });
    return {
        name: `${prefix}${node.name}`,
        type: readType(node.type),
        attributes: (node.attributes || []).map((attribute) => ({
            name: attribute.name,
            type: attribute.type,
            value: cloneAttributeValue(attribute.value)
        })),
        inputs: (node.inputs || []).map((input) => cloneArgument(input)),
        outputs: (node.outputs || []).map((output) => cloneArgument(output)),
        _inlineExpanded: true
    };
};
// this is where the graph is actually build after we have cloned all inputs, attributes
// and outputs from the frag subgraph
const buildExternalInputMap = (batchCallNode, subGraph, srcMappings) => {
    const externalInputs = new Map();
    const boundaryNames = collectSubgraphBoundaryNames(subGraph);

    const assignExternal = (subInputId, values) => {
        if (!subInputId || !values || values.length === 0) {
            return;
        }
        externalInputs.set(subInputId, values);
        for (const boundaryName of boundaryNames) {
            if (boundaryName === subInputId || boundaryName.endsWith(subInputId) || subInputId.endsWith(boundaryName)) {
                externalInputs.set(boundaryName, values);
            }
        }
    };

    for (let index = 0; index < srcMappings.length; index++) {
        const mapping = srcMappings[index];
        const subInputId = mappingEntryId(mapping);
        const batchInput = (batchCallNode.inputs || [])[index];
        if (!subInputId || !batchInput) {
            continue;
        }
        assignExternal(subInputId, argumentValues(batchInput));
    }

    for (const input of subGraph.inputs || []) {
        const inputName = input.name;
        if (!inputName || externalInputs.has(inputName)) {
            continue;
        }
        const mapping = srcMappings.find((entry) => mappingEntryId(entry) === inputName);
        if (!mapping) {
            continue;
        }
        const mappingIndex = srcMappings.indexOf(mapping);
        const batchInput = (batchCallNode.inputs || [])[mappingIndex];
        if (batchInput) {
            assignExternal(inputName, argumentValues(batchInput));
        }
    }

    return externalInputs;
};

const findProducerValueByName = (graph, valueName) => {
    for (const node of graph.nodes || []) {
        for (const output of node.outputs || []) {
            for (const value of argumentValues(output)) {
                if (value && value.name === valueName) {
                    return value;
                }
            }
        }
    }
    return null;
};

const buildOutputReplacementMap = (batchCallNode, subGraph, outMappings, nameMap) => {
    const replacements = new Map();
    for (let index = 0; index < outMappings.length; index++) {
        const mapping = outMappings[index];
        const subOutputId = mappingEntryId(mapping);
        const batchOutput = (batchCallNode.outputs || [])[index];
        const batchValues = argumentValues(batchOutput);
        if (!subOutputId || batchValues.length === 0) {
            continue;
        }

        const originalProducer = findProducerValueByName(subGraph, subOutputId);
        const clonedProducer = originalProducer ? nameMap.get(originalProducer.name) : nameMap.get(subOutputId);
        if (!clonedProducer) {
            continue;
        }
        for (const batchValue of batchValues) {
            if (batchValue && batchValue.name) {
                replacements.set(batchValue.name, clonedProducer);
            }
        }
    }
    return replacements;
};

// wire inputs from the batch call to the frag subgraph
const rewireExternalInputs = (clonedNodes, externalInputs, prefix) => {
    for (const node of clonedNodes) {
        for (const input of node.inputs || []) {
            const nextValues = [];
            for (const value of argumentValues(input)) {
                if (!value || !value.name) {
                    continue;
                }
                const originalName = value.name.startsWith(prefix) ? value.name.slice(prefix.length) : value.name;
                const external = externalInputs.get(originalName);
                if (external && external.length > 0) {
                    nextValues.push(...external);
                } else {
                    nextValues.push(value);
                }
            }
            input.value = nextValues;
        }
    }
};

// prefixing
const replaceValueReferences = (graph, replacements) => {
    if (replacements.size === 0) {
        return;
    }
    const remap = (value) => {
        if (!value || !value.name) {
            return value;
        }
        return replacements.get(value.name) || value;
    };
    const remapArgument = (argument) => {
        argument.value = argumentValues(argument).map((value) => remap(value));
    };
    for (const node of graph.nodes || []) {
        for (const input of node.inputs || []) {
            remapArgument(input);
        }
    }
    for (const output of graph.outputs || []) {
        remapArgument(output);
    }
};

// clones the subgraph and prefixes the nodes
const expandSingleBatchCall = (graph, batchCallName) => {
    const batchIndex = (graph.nodes || []).findIndex((node) => node.name === batchCallName);
    if (batchIndex < 0) {
        return null;
    }
    const batchCallNode = graph.nodes[batchIndex];
    if (batchCallNode.type?.name !== BATCH_CALL_OP) {
        return null;
    }
    const target = resolveBatchCallTarget(graph, batchCallNode);
    if (!target) {
        return null;
    }

    const { subGraph } = target;
    const prefix = `inline::${batchCallNode.name}::`;
    const valueMap = new Map();
    const nameMap = new Map();
    const srcMappings = parseMappingAttribute(getNodeAttribute(batchCallNode, 'src_mappings'));
    const outMappings = parseMappingAttribute(getNodeAttribute(batchCallNode, 'out_mappings'));
    const externalInputs = buildExternalInputMap(batchCallNode, subGraph, srcMappings);

    const clonedNodes = (subGraph.nodes || []).map((node) => cloneNode(node, prefix, valueMap, nameMap));
    rewireExternalInputs(clonedNodes, externalInputs, prefix);

    const outputReplacements = buildOutputReplacementMap(batchCallNode, subGraph, outMappings, nameMap);
    replaceValueReferences(graph, outputReplacements);

    graph.nodes.splice(batchIndex, 1, ...clonedNodes);
    return {
        graph,
        inlinedNodeNames: clonedNodes.map((node) => node.name)
    };
};

// This is the main logic for the inline expansion. 
export const applyBatchInlineExpansions = (graph, expandedBatchCallNames) => {
    if (!graph || !expandedBatchCallNames || expandedBatchCallNames.size === 0) {
        return graph;
    }
    let displayGraph = cloneGraph(graph);
    const inlinedNodeNames = [];
    const batchNames = Array.from(expandedBatchCallNames).filter((name) =>
        (displayGraph.nodes || []).some((node) => node.name === name && node.type?.name === BATCH_CALL_OP)
    );
    for (const batchName of batchNames) {
        const result = expandSingleBatchCall(displayGraph, batchName);
        if (result) {
            displayGraph = result.graph;
            inlinedNodeNames.push(...result.inlinedNodeNames);
        }
    }
    displayGraph._inlineExpandedNodeNames = inlinedNodeNames;
    return displayGraph;
};

export const isBatchCallNode = (node) => {
    return Boolean(node && node.type && node.type.name === BATCH_CALL_OP);
};
