/*
 * Subgraph extract helpers for ambapb runtime graphs.
 * Supports marking nodes by name (including batch-inline clones) and
 * extracting from the post-inline working graph.
 * Most subgraph extract logic was already built in model-editor.js
 * Author: Luray He
 */
import { applyBatchInlineExpansions } from './ambapb-batch-inline.js';
import { SubgraphExtractError } from './model-editor.js';

const INLINE_NAME_PREFIX = /^inline::[^:]+::(.*)$/;

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

export const buildExtractWorkingGraph = (sourceGraph, batchInlineExpanded) => {
    if (!sourceGraph) {
        return null;
    }
    if (!batchInlineExpanded || batchInlineExpanded.size === 0) {
        return sourceGraph;
    }
    return applyBatchInlineExpansions(sourceGraph, batchInlineExpanded);
};

export const resolveMarkedNodesByName = (graph, markers) => {
    const nodes = [];
    for (const marker of markers) {
        const nodeName = marker.nodeName || null;
        if (!nodeName) {
            throw new SubgraphExtractError('Marked nodes are no longer available.');
        }
        const node = (graph.nodes || []).find((entry) => entry.name === nodeName);
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
