/*
 * Breadth-first traversal numbering for graph nodes and connections.
 * Author: Luray He
 */
import { findValueConsumers, findValueProducers } from './model-editor.js';
import { inlineExpansionBatchCallName } from './ambapb-batch-inline.js';

export const FRAG_SHELL_TYPES = new Set(['FragSubgraph', 'UserDefSubgraph']);

const COMPILED_GRAPH_ATTRS = ['compiled_prim_graph', 'graph'];

const argumentValues = (argument) => {
    if (!argument || argument.value === null || argument.value === undefined) {
        return [];
    }
    return Array.isArray(argument.value) ? argument.value : [argument.value];
};

const graphArguments = (node) => {
    if (!node) {
        return [];
    }
    return (node.attributes || []).concat(node.blocks || []);
};

export const getCompiledGraphFromNode = (node) => {
    if (!node) {
        return null;
    }
    for (const name of COMPILED_GRAPH_ATTRS) {
        for (const entry of graphArguments(node)) {
            if (entry.name === name && entry.type === 'graph' && entry.value) {
                return entry.value;
            }
        }
    }
    return null;
};

const isShellNode = (node, skipTypes = FRAG_SHELL_TYPES) => {
    return Boolean(node && node.type && skipTypes.has(node.type.name));
};

const hasInGraphProducer = (graph, node) => {
    for (const input of node.inputs || []) {
        for (const value of argumentValues(input)) {
            if (!value || !value.name || value.initializer) {
                continue;
            }
            for (const producer of findValueProducers(graph, value)) {
                if (producer.node && (graph.nodes || []).includes(producer.node)) {
                    return true;
                }
            }
        }
    }
    return false;
};

const collectNestedGraphs = (graph, graphs = new Set()) => {
    if (!graph || graphs.has(graph)) {
        return graphs;
    }
    graphs.add(graph);
    for (const node of graph.nodes || []) {
        const compiled = getCompiledGraphFromNode(node);
        if (compiled) {
            collectNestedGraphs(compiled, graphs);
        }
    }
    return graphs;
};

// used for clearing the metadata from the graph when we are done with the numbering
export const clearBftMetadata = (graph) => {
    if (!graph) {
        return;
    }
    for (const nested of collectNestedGraphs(graph)) {
        for (const node of nested.nodes || []) {
            delete node._bftNumber;
            delete node._bftWrapperNumber;
            delete node._bftCheckpoint;
            delete node._bftLevel;
        }
        // connections from inputs
        for (const input of nested.inputs || []) {
            for (const value of argumentValues(input)) {
                if (value) {
                    delete value._bftEdgeNumber;
                }
            }
        }
        for (const output of nested.outputs || []) {
            for (const value of argumentValues(output)) {
                if (value) {
                    delete value._bftEdgeNumber;
                }
            }
        }
        for (const node of nested.nodes || []) {
            for (const output of node.outputs || []) {
                for (const value of argumentValues(output)) {
                    if (value) {
                        delete value._bftEdgeNumber;
                    }
                }
            }
        }
    }
};

const graphInputNames = (graph) => {
    const names = new Set();
    for (const input of graph.inputs || []) {
        for (const value of argumentValues(input)) {
            if (value && value.name) {
                names.add(value.name);
            }
        }
    }
    return names;
};

const isEntryNode = (graph, node, inputNames) => {
    let hasNonInitializerInput = false;
    for (const input of node.inputs || []) {
        for (const value of argumentValues(input)) {
            if (!value || !value.name || value.initializer) {
                continue;
            }
            hasNonInitializerInput = true;
            if (inputNames.has(value.name)) {
                return true;
            }
            for (const producer of findValueProducers(graph, value)) {
                if (producer.node && (graph.nodes || []).includes(producer.node)) {
                    return false;
                }
            }
        }
    }
    return hasNonInitializerInput ? false : !hasInGraphProducer(graph, node);
};

const computeBftLevels = (graph, skipTypes, options = {}) => {
    const { entryOnlySources = false } = options;
    const levels = new Map();
    const nodes = (graph.nodes || []).filter((node) => !isShellNode(node, skipTypes));
    const inputNames = graphInputNames(graph);
    const queue = [];
    for (const node of nodes) {
        const isSource = entryOnlySources ?
            isEntryNode(graph, node, inputNames) :
            !hasInGraphProducer(graph, node);
        if (isSource) {
            levels.set(node, 0);
            queue.push(node);
        }
    }
    while (queue.length > 0) {
        const node = queue.shift();
        const level = levels.get(node);
        for (const output of node.outputs || []) {
            for (const value of argumentValues(output)) {
                if (!value || !value.name) {
                    continue;
                }
                for (const consumer of findValueConsumers(graph, value)) {
                    if (!consumer.node || !(graph.nodes || []).includes(consumer.node)) {
                        continue;
                    }
                    if (isShellNode(consumer.node, skipTypes)) {
                        continue;
                    }
                    const next = level + 1;
                    if (!levels.has(consumer.node)) {
                        levels.set(consumer.node, next);
                        queue.push(consumer.node);
                    }
                }
            }
        }
    }
    return levels;
};

const findViewNode = (viewGraph, node) => {
    if (!viewGraph || !node || typeof viewGraph.find !== 'function') {
        return null;
    }
    const found = viewGraph.find(node);
    return found && found.x !== undefined ? found : null;
};

const visualSortKey = (viewNode, layoutDirection, fallbackIndex) => {
    if (viewNode && viewNode.x !== undefined && viewNode.y !== undefined) {
        return layoutDirection === 'vertical' ? viewNode.x : viewNode.y;
    }
    return fallbackIndex;
};

const sortEntriesByVisualPosition = (entries, layoutDirection) => {
    return entries.slice().sort((a, b) => {
        const delta = visualSortKey(a.view, layoutDirection, a.fallbackIndex) -
            visualSortKey(b.view, layoutDirection, b.fallbackIndex);
        if (delta !== 0) {
            return delta;
        }
        return a.fallbackIndex - b.fallbackIndex;
    });
};

const orderedGraphNodes = (graph, viewGraph, options = {}) => {
    const {
        skipTypes = FRAG_SHELL_TYPES,
        assignUnreachableAtEnd = false,
        layoutDirection = 'horizontal',
        entryOnlySources = false
    } = options;

    const levels = computeBftLevels(graph, skipTypes, { entryOnlySources });
    const reachable = new Set(levels.keys());
    const levelGroups = new Map();
    const ordered = [];

    for (const [node, level] of levels.entries()) {
        if (!levelGroups.has(level)) {
            levelGroups.set(level, []);
        }
        levelGroups.get(level).push(node);
    }

    const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
    for (const level of sortedLevels) {
        const entries = levelGroups.get(level).map((node, index) => ({
            node,
            view: findViewNode(viewGraph, node),
            fallbackIndex: (graph.nodes || []).indexOf(node),
            level
        }));
        for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
            ordered.push(entry);
        }
    }

    if (assignUnreachableAtEnd) {
        const unreachable = (graph.nodes || [])
            .filter((node) => !isShellNode(node, skipTypes) && !reachable.has(node))
            .map((node, index) => ({
                node,
                view: findViewNode(viewGraph, node),
                fallbackIndex: index,
                level: Number.MAX_SAFE_INTEGER
            }));
        for (const entry of sortEntriesByVisualPosition(unreachable, layoutDirection)) {
            ordered.push(entry);
        }
    }

    return ordered;
};

const assignNumbersToGraph = (graph, viewGraph, counter, options = {}) => {
    let nextCounter = counter;
    for (const entry of orderedGraphNodes(graph, viewGraph, options)) {
        entry.node._bftNumber = nextCounter++;
        entry.node._bftLevel = entry.level;
    }
    return nextCounter;
};

const graphHasAmbapbShells = (graph) => {
    return (graph.nodes || []).some((node) => isShellNode(node));
};

const collectShellNodes = (graph, typeName) => {
    return (graph.nodes || []).filter((node) => node.type?.name === typeName);
};

const buildBatchCallNumberMap = (sourceGraph, layoutDirection, viewGraph) => {
    const map = new Map();
    if (!sourceGraph) {
        return map;
    }
    let counter = 1;
    for (const entry of orderedGraphNodes(sourceGraph, viewGraph, {
        assignUnreachableAtEnd: false,
        layoutDirection
    })) {
        if (entry.node.type?.name === 'BatchCall' || entry.node.type?.name === 'UserDefCall') {
            if (entry.node.name) {
                map.set(entry.node.name, counter);
            }
        }
        counter++;
    }
    return map;
};

const applyInlineWrapperNumbers = (displayGraph, batchCallNumbers) => {
    for (const node of displayGraph.nodes || []) {
        if (!node._inlineExpanded) {
            continue;
        }
        const batchCallName = inlineExpansionBatchCallName(node);
        if (!batchCallName) {
            continue;
        }
        const wrapperNumber = batchCallNumbers.get(batchCallName);
        if (wrapperNumber != null) {
            node._bftWrapperNumber = wrapperNumber;
        }
    }
};

const assignNestedFragGraphs = (graph, viewGraph, counter, layoutDirection) => {
    const frags = collectShellNodes(graph, 'FragSubgraph');
    const entries = frags.map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let nextCounter = counter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
        const subGraph = getCompiledGraphFromNode(entry.node);
        if (!subGraph) {
            continue;
        }
        nextCounter = assignNumbersToGraph(subGraph, viewGraph, nextCounter, {
            assignUnreachableAtEnd: true,
            entryOnlySources: true,
            layoutDirection
        });
    }
    return nextCounter;
};

const isUserDefNavigationHost = (navigationHost) => {
    const typeName = navigationHost && navigationHost.type && navigationHost.type.name;
    return typeName === 'UserDefSubgraph' || typeName === 'UserDefCall';
};

export const resolveAmbapbNumberingMode = (ctx) => {
    const { displayGraph, navigationHost = null } = ctx || {};
    if (!displayGraph) {
        return 'plain';
    }
    if (isUserDefNavigationHost(navigationHost)) {
        return 'compiledUserDef';
    }
    if (displayGraph._ambapbCompiledGraph) {
        return 'compiledFrag';
    }
    if (graphHasAmbapbShells(displayGraph)) {
        return 'runtime';
    }
    return 'plain';
};

const assignUserDefInnerFrags = (graph, viewGraph, layoutDirection) => {
    const innerFrags = collectShellNodes(graph, 'FragSubgraph').map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let localCounter = 1;
    for (const fragEntry of sortEntriesByVisualPosition(innerFrags, layoutDirection).reverse()) {
        const subGraph = getCompiledGraphFromNode(fragEntry.node);
        if (!subGraph) {
            continue;
        }
        localCounter = assignNumbersToGraph(subGraph, viewGraph, localCounter, {
            assignUnreachableAtEnd: true,
            entryOnlySources: true,
            layoutDirection
        });
    }
};

const assignUserDefSubgraphs = (graph, viewGraph, counter, layoutDirection) => {
    const userDefs = collectShellNodes(graph, 'UserDefSubgraph');
    const entries = userDefs.map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let nextCounter = counter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection).reverse()) {
        entry.node._bftCheckpoint = nextCounter;
        const compiled = getCompiledGraphFromNode(entry.node);
        if (!compiled) {
            continue;
        }
        assignUserDefInnerFrags(compiled, viewGraph, layoutDirection);
    }
    return nextCounter;
};

export const assignBftNumbers = (ctx) => {
    const {
        displayGraph,
        sourceGraph = null,
        viewGraph = null,
        layoutDirection = 'horizontal',
        navigationHost = null
    } = ctx || {};

    if (!displayGraph) {
        return;
    }

    const metadataRoot = sourceGraph || displayGraph;
    clearBftMetadata(metadataRoot);

    const mode = resolveAmbapbNumberingMode({ displayGraph, navigationHost });

    if (mode === 'compiledUserDef') {
        assignUserDefInnerFrags(displayGraph, viewGraph, layoutDirection);
    } else {
        let counter = assignNumbersToGraph(displayGraph, viewGraph, 1, {
            assignUnreachableAtEnd: mode === 'compiledFrag',
            entryOnlySources: mode === 'compiledFrag',
            layoutDirection
        });

        if (mode === 'runtime') {
            counter = assignNestedFragGraphs(displayGraph, viewGraph, counter, layoutDirection);
            assignUserDefSubgraphs(displayGraph, viewGraph, counter, layoutDirection);
        }
    }

    const batchCallNumbers = buildBatchCallNumberMap(sourceGraph || displayGraph, layoutDirection, viewGraph);
    applyInlineWrapperNumbers(displayGraph, batchCallNumbers);
};

const isGraphTerminalViewNode = (viewNode) => {
    if (!viewNode || !viewNode.class) {
        return false;
    }
    return viewNode.class === 'graph-input' || viewNode.class === 'graph-output';
};

const edgeMidpointSortKey = (fromView, toView, layoutDirection) => {
    if (!fromView || !toView || fromView.x === undefined || toView.x === undefined) {
        return 0;
    }
    if (layoutDirection === 'vertical') {
        return (fromView.x + toView.x) / 2;
    }
    return (fromView.y + toView.y) / 2;
};

export const assignEdgeBftNumbers = (ctx) => {
    const {
        viewGraph = null,
        layoutDirection = 'horizontal'
    } = ctx || {};

    if (!viewGraph || !viewGraph.edges) {
        return;
    }

    const edgeEntries = [];
    for (const entry of viewGraph.edges.values()) {
        const edge = entry.label;
        if (!edge || !edge.from || !edge.to || !edge.value) {
            continue;
        }
        if (isGraphTerminalViewNode(edge.from) || isGraphTerminalViewNode(edge.to)) {
            continue;
        }
        const fromNode = edge.from.value;
        const toNode = edge.to.value;
        if (!fromNode || !toNode) {
            continue;
        }
        if (fromNode._bftLevel == null && fromNode._bftNumber == null) {
            continue;
        }
        if (toNode._bftLevel == null && toNode._bftNumber == null) {
            continue;
        }
        const fromLevel = fromNode._bftLevel != null ? fromNode._bftLevel : 0;
        const toLevel = toNode._bftLevel != null ? toNode._bftLevel : 0;
        const level = Math.min(fromLevel, toLevel);
        const tensorValue = edge.value.value;
        if (tensorValue) {
            delete tensorValue._bftEdgeNumber;
        }
        edgeEntries.push({
            edge,
            tensorValue,
            level,
            sortKey: edgeMidpointSortKey(edge.from, edge.to, layoutDirection)
        });
    }

    edgeEntries.sort((a, b) => {
        if (a.level !== b.level) {
            return a.level - b.level;
        }
        return a.sortKey - b.sortKey;
    });

    let counter = 1;
    for (const entry of edgeEntries) {
        if (entry.tensorValue) {
            entry.tensorValue._bftEdgeNumber = counter++;
        }
    }
};

export const resolveNodeBftNumber = (node) => {
    return node && node._bftNumber != null ? node._bftNumber : null;
};

export const resolveEdgeBftNumber = (value) => {
    return value && value._bftEdgeNumber != null ? value._bftEdgeNumber : null;
};

export const nodeIsInDisplayedGraph = (node, displayGraph) => {
    if (!node || !displayGraph || !Array.isArray(displayGraph.nodes)) {
        return false;
    }
    return displayGraph.nodes.includes(node);
};
