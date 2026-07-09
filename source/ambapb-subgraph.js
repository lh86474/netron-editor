/*
 * Subgraph extract helpers for ambapb runtime graphs.
 * Supports marking nodes by name (including batch-inline clones) and
 * extracting from the post-inline working graph.
 * Most subgraph extract logic was already built in model-editor.js
 * Author: Luray He
 */
import {
    applyBatchInlineExpansions,
    inlineExpansionBatchCallName,
    resolveBatchCallTarget
} from './ambapb-batch-inline.js';
import { cloneGraph, SubgraphExtractError, promoteVisibleGraphOutputs } from './model-editor.js';

const INLINE_NAME_PREFIX = /^inline::[^:]+::(.*)$/;

const graphArguments = (node) => {
    if (!node) {
        return [];
    }
    return (node.attributes || []).concat(node.blocks || []);
};

const promoteNestedGraphOutputs = (graph) => {
    if (!graph) {
        return graph;
    }
    promoteVisibleGraphOutputs(graph);
    for (const node of graph.nodes || []) {
        for (const entry of graphArguments(node)) {
            if (entry && entry.type === 'graph' && entry.value) {
                promoteNestedGraphOutputs(entry.value);
            }
        }
    }
    return graph;
};

export { promoteNestedGraphOutputs };

const argumentValues = (argument) => {
    if (!argument || argument.value === null || argument.value === undefined) {
        return [];
    }
    return Array.isArray(argument.value) ? argument.value : [argument.value];
};

export const stripInlineExpansionName = (name) => {
    if (!name || typeof name !== 'string') {
        return name;
    }
    const match = INLINE_NAME_PREFIX.exec(name);
    return match ? match[1] : name;
};

export const resolveExtractGraphContext = (rootGraph, marker) => {
    if (!rootGraph || !marker || !marker.nodeId) {
        return { extractGraph: rootGraph, replaceTarget: null };
    }
    const match = /^graph:(\d+)\/node:(\d+)\/([^/]+)\/node:\d+$/.exec(marker.nodeId);
    if (!match) {
        return { extractGraph: rootGraph, replaceTarget: null };
    }
    const hostNodeIndex = Number(match[2]);
    const attrName = match[3];
    const hostNode = (rootGraph.nodes || [])[hostNodeIndex];
    if (!hostNode) {
        return { extractGraph: rootGraph, replaceTarget: null };
    }
    const graphEntry = [...(hostNode.attributes || []), ...(hostNode.blocks || [])]
        .find((entry) => entry.name === attrName && entry.type === 'graph' && entry.value);
    if (!graphEntry) {
        return { extractGraph: rootGraph, replaceTarget: null };
    }
    return {
        extractGraph: graphEntry.value,
        replaceTarget: { hostNodeIndex, attrName }
    };
};

export const applyExtractedGraph = (rootGraph, replaceTarget, extracted) => {
    if (!replaceTarget) {
        return extracted;
    }
    const hostNode = (rootGraph.nodes || [])[replaceTarget.hostNodeIndex];
    if (!hostNode) {
        return rootGraph;
    }
    for (const entry of [...(hostNode.attributes || []), ...(hostNode.blocks || [])]) {
        if (entry.name === replaceTarget.attrName && entry.type === 'graph') {
            entry.value = extracted;
            break;
        }
    }
    return rootGraph;
};

export const buildExtractWorkingGraph = (sourceGraph, batchInlineExpanded) => {
    if (!sourceGraph) {
        return null;
    }
    if (!batchInlineExpanded || batchInlineExpanded.size === 0) {
        return sourceGraph;
    }
    return applyBatchInlineExpansions(sourceGraph, batchInlineExpanded);
};

const resolveNodeByEntityId = (graph, entityId) => {
    if (!graph || !entityId) {
        return null;
    }
    const topMatch = /^graph:\d+\/node:(\d+)$/.exec(entityId);
    if (topMatch) {
        const node = (graph.nodes || [])[Number(topMatch[1])];
        if (node) {
            return node;
        }
    }
    for (const node of graph.nodes || []) {
        if (node._sourceEntityId === entityId) {
            return node;
        }
    }
    return null;
};

export const resolveMarkedNodesByName = (graph, markers) => {
    const nodes = [];
    for (const marker of markers) {
        let node = null;
        if (marker.nodeId) {
            node = resolveNodeByEntityId(graph, marker.nodeId);
        }
        if (!node && marker.nodeIndex !== undefined && marker.nodeIndex >= 0) {
            node = (graph.nodes || [])[marker.nodeIndex];
        }
        if (!node && marker.nodeName) {
            node = (graph.nodes || []).find((entry) => entry.name === marker.nodeName);
        }
        if (!node) {
            throw new SubgraphExtractError('Marked nodes are no longer available.');
        }
        nodes.push(node);
    }
    return nodes;
};

const remapValue = (value) => {
    if (!value || !value.name) {
        return value;
    }
    const nextName = stripInlineExpansionName(value.name);
    if (nextName === value.name) {
        return value;
    }
    return Object.assign({}, value, { name: nextName });
};

const remapArgument = (argument) => {
    if (!argument) {
        return argument;
    }
    return Object.assign({}, argument, {
        value: argumentValues(argument).map((entry) => remapValue(entry))
    });
};

export const cloneFragSubgraphNode = (fragNode) => {
    const cloneGraphAttribute = (attribute) => {
        if (attribute.type === 'graph' && attribute.value) {
            return {
                name: attribute.name,
                type: attribute.type,
                value: cloneGraph(attribute.value)
            };
        }
        return {
            name: attribute.name,
            type: attribute.type,
            value: attribute.value
        };
    };
    return {
        name: fragNode.name,
        type: fragNode.type ? Object.assign({}, fragNode.type) : null,
        attributes: (fragNode.attributes || []).map(cloneGraphAttribute),
        blocks: (fragNode.blocks || []).map(cloneGraphAttribute),
        inputs: (fragNode.inputs || []).map((input) => ({
            name: input.name,
            value: (input.value || []).map((val) => Object.assign({}, val))
        })),
        outputs: (fragNode.outputs || []).map((output) => ({
            name: output.name,
            value: (output.value || []).map((val) => Object.assign({}, val))
        }))
    };
};

export const ensureFragSubgraphGraphAttributes = (graph) => {
    for (const node of graph.nodes || []) {
        if (node.type?.name !== 'FragSubgraph' && node.type?.name !== 'UserDefSubgraph') {
            continue;
        }
        for (const entry of [...(node.attributes || []), ...(node.blocks || [])]) {
            if (entry.type === 'graph' && entry.value) {
                entry.value = cloneGraph(entry.value);
            }
        }
    }
};

export const collectReferencedSubgraphDefinitions = (extracted, workingGraph, extractSourceGraph, options = {}) => {
    const callsToInline = options.callsToInline || new Set();
    const definitions = [];
    const seen = new Set();
    const addDefinition = (definitionNode) => {
        if (!definitionNode || !definitionNode.name || seen.has(definitionNode.name)) {
            return;
        }
        if ((extracted.nodes || []).some((node) => node.name === definitionNode.name)) {
            return;
        }
        seen.add(definitionNode.name);
        definitions.push(definitionNode);
    };

    for (const node of extracted.nodes || []) {
        if (node.type?.name === 'BatchCall' || node.type?.name === 'UserDefCall') {
            const target = resolveBatchCallTarget(workingGraph, node);
            if (target && target.fragSubgraphNode) {
                addDefinition(target.fragSubgraphNode);
            }
        }
    }

    for (const node of extracted.nodes || []) {
        const batchCallName = inlineExpansionBatchCallName(node);
        if (!batchCallName) {
            continue;
        }
        const originalBatchCall = (extractSourceGraph.nodes || []).find((entry) => entry.name === batchCallName);
        if (!originalBatchCall) {
            continue;
        }
        const target = resolveBatchCallTarget(extractSourceGraph, originalBatchCall);
        if (target && target.fragSubgraphNode) {
            addDefinition(target.fragSubgraphNode);
        }
    }

    for (const batchCallName of callsToInline) {
        const originalBatchCall = (extractSourceGraph.nodes || []).find((entry) => entry.name === batchCallName);
        if (!originalBatchCall) {
            continue;
        }
        const target = resolveBatchCallTarget(extractSourceGraph, originalBatchCall);
        if (target && target.fragSubgraphNode) {
            addDefinition(target.fragSubgraphNode);
        }
    }

    return definitions;
};

export const appendReferencedSubgraphDefinitions = (extracted, workingGraph, extractSourceGraph, options = {}) => {
    const definitions = collectReferencedSubgraphDefinitions(extracted, workingGraph, extractSourceGraph, options);
    for (const definition of definitions) {
        extracted.nodes.push(cloneFragSubgraphNode(definition));
    }
    return extracted;
};

export const isSubgraphDefinitionNode = (node) => {
    return Boolean(node && node.type && (
        node.type.name === 'FragSubgraph' || node.type.name === 'UserDefSubgraph'
    ));
};

export const stripInlineExpansionPrefixes = (graph) => {
    if (!graph) {
        return graph;
    }
    const nodes = (graph.nodes || []).map((node) => {
        const next = Object.assign({}, node, {
            name: stripInlineExpansionName(node.name),
            inputs: (node.inputs || []).map((input) => remapArgument(input)),
            outputs: (node.outputs || []).map((output) => remapArgument(output))
        });
        delete next._inlineExpanded;
        return next;
    });
    return Object.assign({}, graph, {
        nodes,
        inputs: (graph.inputs || []).map((input) => remapArgument(input)),
        outputs: (graph.outputs || []).map((output) => remapArgument(output))
    });
};
