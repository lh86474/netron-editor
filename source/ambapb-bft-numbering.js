/*
 * Breadth-first traversal numbering for graph nodes and connections.
 * Author: Luray He
 */
import { findValueConsumers, findValueProducers } from './model-editor.js';
import { inlineExpansionBatchCallName, resolveBatchCallTarget } from './ambapb-batch-inline.js';

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

export const getCompiledGraphAttrName = (node) => {
    if (!node) {
        return null;
    }
    for (const name of COMPILED_GRAPH_ATTRS) {
        for (const entry of graphArguments(node)) {
            if (entry.name === name && entry.type === 'graph' && entry.value) {
                return name;
            }
        }
    }
    return null;
};

const SUBGRAPH_GRAPH_ATTR = 'graph';
const COMPILED_PRIM_GRAPH_ATTR = 'compiled_prim_graph';

const getGraphAttribute = (node, attrName) => {
    if (!node) {
        return null;
    }
    for (const entry of graphArguments(node)) {
        if (entry.name === attrName && entry.type === 'graph' && entry.value) {
            return entry.value;
        }
    }
    return null;
};

const getMainScopeSubgraphFromNode = (node) => getSubgraphGraphFromNode(node);
 

export const getSubgraphGraphFromNode = (node) => getGraphAttribute(node, SUBGRAPH_GRAPH_ATTR);

export const getGraphAttrNameForModelGraph = (shellNode, modelGraph) => {
    if (!shellNode || !modelGraph) {
        return null;
    }
    if (getCompiledPrimGraphFromNode(shellNode) === modelGraph) {
        return 'compiled_prim_graph';
    }
    if (getSubgraphGraphFromNode(shellNode) === modelGraph) {
        return 'graph';
    }
    return null;
};

export const findNestedViewGraphForModelGraph = (paneViewGraph, modelGraph) => {
    if (!paneViewGraph || !modelGraph || !isViewGraphLike(paneViewGraph)) {
        return null;
    }
    let found = null;
    forEachNestedViewGraph(paneViewGraph, (nestedViewGraph) => {
        if (!found && nestedViewGraph.target === modelGraph) {
            found = nestedViewGraph;
        }
    });
    return found;
};

export const getCompiledPrimGraphFromNode = (node) => getGraphAttribute(node, COMPILED_PRIM_GRAPH_ATTR);

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

const graphOutputNames = (graph) => {
    const names = new Set();
    for (const output of graph.outputs || []) {
        for (const value of argumentValues(output)) {
            if (value && value.name) {
                names.add(value.name);
            }
        }
    }
    return names;
};

const graphHasDeclaredInputs = (graph) => {
    return (graph.inputs || []).length > 0;
};

const resolveEntryOnlySources = (graph, entryOnlySources) => {
    return entryOnlySources || graphHasDeclaredInputs(graph);
};

const findGraphInputView = (viewGraph, inputArgument) => {
    if (!viewGraph || !inputArgument || typeof viewGraph.find !== 'function') {
        return null;
    }
    const found = viewGraph.find(inputArgument);
    return found && found.x !== undefined ? found : null;
};

const graphInputVisualOrder = (graph, viewGraph, layoutDirection) => {
    const entries = (graph.inputs || []).map((input, index) => ({
        index,
        view: findGraphInputView(viewGraph, input),
        fallbackIndex: index
    }));
    return sortEntriesByVisualPosition(entries, layoutDirection).map((entry) => entry.index);
};

const entryNodePrimaryInputOrder = (graph, node, inputNames, viewGraph, layoutDirection) => {
    const visualOrder = graphInputVisualOrder(graph, viewGraph, layoutDirection);
    let bestOrder = Number.MAX_SAFE_INTEGER;
    for (let order = 0; order < visualOrder.length; order++) {
        const inputIndex = visualOrder[order];
        const input = graph.inputs[inputIndex];
        for (const value of argumentValues(input)) {
            if (!value || !value.name || !inputNames.has(value.name)) {
                continue;
            }
            for (const nodeInput of node.inputs || []) {
                for (const bound of argumentValues(nodeInput)) {
                    if (bound && bound.name === value.name) {
                        bestOrder = Math.min(bestOrder, order);
                    }
                }
            }
        }
    }
    return bestOrder;
};

const isGraphTerminalViewNode = (viewNode) => {
    return Boolean(viewNode && (viewNode.class === 'graph-input' || viewNode.class === 'graph-output'));
};

const viewNodeModelValue = (viewNode) => {
    if (!viewNode || viewNode.value === undefined) {
        return null;
    }
    return viewNode.value;
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

const isViewGraphLike = (viewGraph) => {
    return Boolean(viewGraph && viewGraph.edges instanceof Map && typeof viewGraph.find === 'function');
};

const isGraphBlock = (block) => {
    return Boolean(block && isViewGraphLike(block.target));
};

const walkViewNodeBlocks = (viewNode, visitor) => {
    if (!viewNode || !Array.isArray(viewNode.blocks)) {
        return;
    }
    for (const block of viewNode.blocks) {
        if (isGraphBlock(block)) {
            visitor(block.target);
        }
        if (Array.isArray(block._items)) {
            for (const item of block._items) {
                const content = item.content;
                if (content && Array.isArray(content.blocks)) {
                    for (const innerBlock of content.blocks) {
                        if (isGraphBlock(innerBlock)) {
                            visitor(innerBlock.target);
                        }
                    }
                }
            }
        }
    }
};

const forEachNestedViewGraph = (viewGraph, visitor) => {
    if (!isViewGraphLike(viewGraph) || !viewGraph.nodes) {
        return;
    }
    for (const entry of viewGraph.nodes.values()) {
        const viewNode = entry && entry.label;
        walkViewNodeBlocks(viewNode, (nestedViewGraph) => {
            visitor(nestedViewGraph);
            forEachNestedViewGraph(nestedViewGraph, visitor);
        });
    }
};

const findNestedViewGraphForHost = (viewGraph, hostNode) => {
    const compiled = getCompiledGraphFromNode(hostNode);
    if (!compiled || !isViewGraphLike(viewGraph)) {
        return null;
    }
    let found = null;
    forEachNestedViewGraph(viewGraph, (nestedViewGraph) => {
        if (!found && nestedViewGraph.target === compiled) {
            found = nestedViewGraph;
        }
    });
    return found;
};

const collectViewEdges = (viewGraph) => {
    const edges = [];
    if (!viewGraph || !viewGraph.edges) {
        return edges;
    }
    for (const entry of viewGraph.edges.values()) {
        const edge = entry.label;
        if (edge && !edge._tunnel) {
            edges.push(edge);
        }
    }
    return edges;
};

const clearViewEdgeNumbersInScope = (viewGraph) => {
    for (const edge of collectViewEdges(viewGraph)) {
        delete edge._bftEdgeNumber;
    }
};

const clearAllViewEdgeNumbers = (viewGraph) => {
    if (!isViewGraphLike(viewGraph)) {
        return;
    }
    clearViewEdgeNumbersInScope(viewGraph);
    forEachNestedViewGraph(viewGraph, clearViewEdgeNumbersInScope);
};

const orderTerminalEdges = (edges, layoutDirection) => {
    return sortEntriesByVisualPosition(edges.map((edge, index) => ({
        edge,
        view: edge.from,
        fallbackIndex: index
    })), layoutDirection).map((entry) => entry.edge);
};

const orderOutputTerminalEdges = (edges, layoutDirection) => {
    return sortEntriesByVisualPosition(edges.map((edge, index) => ({
        edge,
        view: edge.to,
        fallbackIndex: index
    })), layoutDirection).map((entry) => entry.edge);
};

const orderInternalEdges = (edges, layoutDirection) => {
    return edges.slice().sort((a, b) => {
        const aFromNode = viewNodeModelValue(a.from);
        const bFromNode = viewNodeModelValue(b.from);
        const aOrder = aFromNode && aFromNode._bftNumber != null ? aFromNode._bftNumber : Infinity;
        const bOrder = bFromNode && bFromNode._bftNumber != null ? bFromNode._bftNumber : Infinity;
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        return edgeMidpointSortKey(a.from, a.to, layoutDirection) -
            edgeMidpointSortKey(b.from, b.to, layoutDirection);
    });
};

const mirrorEdgeNumberToTensor = (edge, number) => {
    edge._bftEdgeNumber = number;
    const tensor = edge.value && edge.value.value;
    if (tensor) {
        tensor._bftEdgeNumber = number;
    }
};

const isEntryNode = (graph, node, inputNames) => {
    for (const input of node.inputs || []) {
        for (const value of argumentValues(input)) {
            if (!value || !value.name || value.initializer) {
                continue;
            }
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
    if (inputNames.size === 0) {
        return !hasInGraphProducer(graph, node);
    }
    return false;
};

const computeBftLevels = (graph, skipTypes, options = {}) => {
    const { entryOnlySources = false } = options;
    const seedFromGraphInputs = resolveEntryOnlySources(graph, entryOnlySources);
    const levels = new Map();
    const nodes = (graph.nodes || []).filter((node) => !isShellNode(node, skipTypes));
    const inputNames = graphInputNames(graph);
    const queue = [];
    for (const node of nodes) {
        const isSource = seedFromGraphInputs ?
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
        if (a.inputOrder != null && b.inputOrder != null && a.inputOrder !== b.inputOrder) {
            return a.inputOrder - b.inputOrder;
        }
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
    const inputNames = graphInputNames(graph);

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
            inputOrder: level === 0 && graphHasDeclaredInputs(graph) ?
                entryNodePrimaryInputOrder(graph, node, inputNames, viewGraph, layoutDirection) :
                null,
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

const assignNumbersToGraphNodes = (graph, viewGraph, nodeCounter, options = {}) => {
    let nextCounter = nodeCounter;
    for (const entry of orderedGraphNodes(graph, viewGraph, options)) {
        entry.node._bftNumber = nextCounter++;
        entry.node._bftLevel = entry.level;
    }
    return nextCounter;
};

const graphHasAmbapbShells = (graph) => {
    return (graph.nodes || []).some((node) => isShellNode(node));
};

const buildBatchCallNumberMap = (sourceGraph, layoutDirection, viewGraph) => {
    const map = new Map();
    if (!sourceGraph) {
        return map;
    }
    let counter = 1;
    for (const entry of orderedGraphNodes(sourceGraph, viewGraph, {
        assignUnreachableAtEnd: false,
        entryOnlySources: true,
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

const snapshotBftNumbers = (graph) => {
    const byNode = new Map();
    for (const nested of collectNestedGraphs(graph)) {
        for (const node of nested.nodes || []) {
            if (node._bftNumber != null) {
                byNode.set(node, node._bftNumber);
            }
        }
    }
    return byNode;
};

const applyPersistedInlineBftNumbers = (displayGraph, sourceBftByNode) => {
    for (const node of displayGraph.nodes || []) {
        if (!node._inlineExpanded || !node._sourceNode) {
            continue;
        }
        const persisted = sourceBftByNode.get(node._sourceNode);
        if (persisted == null) {
            continue;
        }
        node._bftNumber = persisted;
    }
};

const applyPersistedBftNumbersToGraph = (graph, sourceBftByNode) => {
    if (!graph || !sourceBftByNode || sourceBftByNode.size === 0) {
        return;
    }
    for (const nested of collectNestedGraphs(graph)) {
        for (const node of nested.nodes || []) {
            const persisted = sourceBftByNode.get(node);
            if (persisted != null) {
                node._bftNumber = persisted;
            }
        }
    }
};

const minBftNumberInGraph = (graph) => {
    if (!graph) {
        return null;
    }
    let min = null;
    for (const node of graph.nodes || []) {
        if (node._bftNumber != null) {
            min = min == null ? node._bftNumber : Math.min(min, node._bftNumber);
        }
        const compiled = getCompiledGraphFromNode(node);
        if (compiled) {
            const nested = minBftNumberInGraph(compiled);
            if (nested != null) {
                min = min == null ? nested : Math.min(min, nested);
            }
        }
    }
    return min;
};

const buildBatchCallNumberMapFromNumberedSource = (sourceGraph) => {
    const map = new Map();
    if (!sourceGraph) {
        return map;
    }
    for (const node of sourceGraph.nodes || []) {
        if (node.type?.name !== 'BatchCall' && node.type?.name !== 'UserDefCall') {
            continue;
        }
        const target = resolveBatchCallTarget(sourceGraph, node);
        const wrapperNumber = minBftNumberInGraph(target);
        if (wrapperNumber != null && node.name) {
            map.set(node.name, wrapperNumber);
        }
    }
    return map;
};

const isFragShellHost = (node) => (
    node.type?.name === 'FragSubgraph' || node.type?.name === 'UserDefSubgraph'
);

const collectCompiledGraphHosts = (graph) => {
    return (graph.nodes || []).filter((node) => getCompiledGraphFromNode(node) || getSubgraphGraphFromNode(node));
};

const graphHasCompiledGraphHosts = (graph) => {
    return collectCompiledGraphHosts(graph).length > 0;
};

// Nested compiled_prim_graph bodies are not numbered. FragSubgraph/UserDefSubgraph
// `graph` attribute bodies continue the global node counter. Recurse into both so
// nested `graph` shells deeper inside a compiled_prim_graph still get numbers.
const assignNestedCompiledHosts = (graph, viewGraph, nodeCounter, layoutDirection) => {
    const entries = collectCompiledGraphHosts(graph).map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let nextCounter = nodeCounter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
        const compiledPrim = getCompiledPrimGraphFromNode(entry.node);
        const subgraphDef = getSubgraphGraphFromNode(entry.node);
        if (compiledPrim) {
            nextCounter = assignNestedCompiledHosts(compiledPrim, viewGraph, nextCounter, layoutDirection);
        }
        if (subgraphDef && subgraphDef !== compiledPrim) {
            nextCounter = assignNumbersToGraphNodes(subgraphDef, viewGraph, nextCounter, {
                assignUnreachableAtEnd: true,
                entryOnlySources: true,
                layoutDirection
            });
            nextCounter = assignNestedCompiledHosts(subgraphDef, viewGraph, nextCounter, layoutDirection);
        }
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
        return 'compiledFrag';
    }
    if (displayGraph._ambapbCompiledGraph) {
        return 'compiledFrag';
    }
    if (graphHasAmbapbShells(displayGraph) || graphHasCompiledGraphHosts(displayGraph)) {
        return 'runtime';
    }
    return 'plain';
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
    const compiledLike = mode === 'compiledFrag';
    const runtimeLike = mode === 'runtime';
    const drilledView = compiledLike && sourceGraph && sourceGraph !== displayGraph;

    let sourceBftByNode = new Map();
    if (sourceGraph && runtimeLike) {
        let sourceCounter = assignNumbersToGraphNodes(sourceGraph, viewGraph, 1, {
            assignUnreachableAtEnd: false,
            entryOnlySources: resolveEntryOnlySources(sourceGraph, false),
            layoutDirection
        });
        sourceCounter = assignNestedCompiledHosts(sourceGraph, viewGraph, sourceCounter, layoutDirection);
        sourceBftByNode = snapshotBftNumbers(sourceGraph);
        clearBftMetadata(sourceGraph);
    }

   if (drilledView && sourceBftByNode.size > 0) {
        applyPersistedBftNumbersToGraph(displayGraph, sourceBftByNode);
    } else {
        let nodeCounter = assignNumbersToGraphNodes(displayGraph, viewGraph, 1, {
            assignUnreachableAtEnd: false,
            entryOnlySources: resolveEntryOnlySources(displayGraph, compiledLike),
            layoutDirection
        });

        if (mode === 'runtime' || mode === 'compiledFrag') {
            nodeCounter = assignNestedCompiledHosts(displayGraph, viewGraph, nodeCounter, layoutDirection);
        }
    } 

    const displayTraversalByNode = new Map();
    for (const node of displayGraph.nodes || []) {
        if (node._inlineExpanded && node._bftNumber != null) {
            displayTraversalByNode.set(node, node._bftNumber);
        }
    }

    applyPersistedInlineBftNumbers(displayGraph, sourceBftByNode);

    for (const [node, traversalNumber] of displayTraversalByNode) {
        node._bftWrapperNumber = traversalNumber;
    }

    assignEdgeBftNumbers({ viewGraph, layoutDirection, displayGraph });
};

const assignEdgeNumbersInScope = (viewGraph, layoutDirection, counter) => {
    if (!isViewGraphLike(viewGraph)) {
        return counter;
    }

    const inputEdges = [];
    const internalEdges = [];
    const outputEdges = [];

    for (const edge of collectViewEdges(viewGraph)) {
        if (!edge.from || !edge.to) {
            continue;
        }
        if (edge.from.class === 'graph-input') {
            inputEdges.push(edge);
        } else if (edge.to.class === 'graph-output') {
            outputEdges.push(edge);
        } else if (!isGraphTerminalViewNode(edge.from) && !isGraphTerminalViewNode(edge.to)) {
            internalEdges.push(edge);
        }
    }

    const ordered = [
        ...orderTerminalEdges(inputEdges, layoutDirection),
        ...orderInternalEdges(internalEdges, layoutDirection),
        ...orderOutputTerminalEdges(outputEdges, layoutDirection)
    ];

    let nextCounter = counter;
    for (const edge of ordered) {
        mirrorEdgeNumberToTensor(edge, nextCounter++);
    }
    return nextCounter;
};

const hostNestedModelGraphs = (host) => {
    const graphs = [];
    const compiledPrim = getCompiledPrimGraphFromNode(host);
    const subgraphDef = getSubgraphGraphFromNode(host);
    if (compiledPrim) {
        graphs.push(compiledPrim);
    }
    if (subgraphDef && subgraphDef !== compiledPrim) {
        graphs.push(subgraphDef);
    }
    return graphs;
};

const assignHostNestedEdges = (host, viewGraph, layoutDirection, counter) => {
    const nestedViewGraph = findNestedViewGraphForHost(viewGraph, host);
    let nextCounter = counter;
    if (nestedViewGraph && nestedViewGraph.target) {
        nextCounter = assignMainEdgesWithCompiledDive(nestedViewGraph.target, nestedViewGraph, layoutDirection, nextCounter);
        nextCounter = assignFragShellEdgesAfterMain(nestedViewGraph.target, viewGraph, layoutDirection, nextCounter);
        return nextCounter;
    } 
    if (nestedViewGraph) {
        nextCounter = assignEdgeNumbersInScope(nestedViewGraph, layoutDirection, nextCounter);
    } else {
        for (const nested of hostNestedModelGraphs(host)) {
            nextCounter = assignModelGraphEdgeNumbersInScope(nested, nextCounter, {
                reserveSharedInputs: true
            });
        }
    }
    for (const nested of hostNestedModelGraphs(host)) {
        nextCounter = assignNestedHostsEdges(nested, viewGraph, layoutDirection, nextCounter);
    }
    return nextCounter;
};

// All nested hosts (NVP + Frag) inside a model graph, visual order.
const assignNestedHostsEdges = (modelGraph, viewGraph, layoutDirection, counter) => {
    const entries = collectCompiledGraphHosts(modelGraph).map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let nextCounter = counter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
        nextCounter = assignHostNestedEdges(entry.node, viewGraph, layoutDirection, nextCounter);
    }
    return nextCounter;
};

// Main-graph edges first, diving into non-Frag compiled_prim_graph hosts in
// top-level node order; FragSubgraph/UserDefSubgraph bodies are numbered after.
const assignMainEdgesWithCompiledDive = (modelGraph, viewGraph, layoutDirection, counter) => {
    if (!isViewGraphLike(viewGraph)) {
        return counter;
    }

    const inputEdges = [];
    const internalEdges = [];
    const outputEdges = [];
    for (const edge of collectViewEdges(viewGraph)) {
        if (!edge.from || !edge.to) {
            continue;
        }
        if (edge.from.class === 'graph-input') {
            inputEdges.push(edge);
        } else if (edge.to.class === 'graph-output') {
            outputEdges.push(edge);
        } else if (!isGraphTerminalViewNode(edge.from) && !isGraphTerminalViewNode(edge.to)) {
            internalEdges.push(edge);
        }
    }

    const numbered = new Set();
    let nextCounter = counter;
    const numberEdge = (edge) => {
        if (!edge || numbered.has(edge) || edge._bftEdgeNumber != null) {
            return;
        }
        numbered.add(edge);
        mirrorEdgeNumberToTensor(edge, nextCounter++);
    };

    for (const edge of orderTerminalEdges(inputEdges, layoutDirection)) {
        numberEdge(edge);
    }

    const orderedNodes = orderedGraphNodes(modelGraph, viewGraph, {
        skipTypes: FRAG_SHELL_TYPES,
        assignUnreachableAtEnd: false,
        entryOnlySources: resolveEntryOnlySources(modelGraph, false),
        layoutDirection
    });
    for (const entry of orderedNodes) {
        const fromNode = entry.node;
        const compiledPrim = getCompiledPrimGraphFromNode(fromNode);
        if (compiledPrim && !isFragShellHost(fromNode)) {
            nextCounter = assignHostNestedEdges(fromNode, viewGraph, layoutDirection, nextCounter);
        }
        for (const edge of orderInternalEdges(internalEdges, layoutDirection)) {
            if (viewNodeModelValue(edge.from) === fromNode) {
                numberEdge(edge);
            }
        }
    }

    for (const edge of orderInternalEdges(internalEdges, layoutDirection)) {
        numberEdge(edge);
    }
    for (const edge of orderOutputTerminalEdges(outputEdges, layoutDirection)) {
        numberEdge(edge);
    }
    return nextCounter;
};

const assignFragShellEdgesAfterMain = (modelGraph, viewGraph, layoutDirection, counter) => {
    const entries = (modelGraph.nodes || [])
        .filter((node) => isFragShellHost(node) && (getCompiledGraphFromNode(node) || getSubgraphGraphFromNode(node)))
        .map((node, index) => ({
            node,
            view: findViewNode(viewGraph, node),
            fallbackIndex: index
        }));
    let nextCounter = counter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
        nextCounter = assignHostNestedEdges(entry.node, viewGraph, layoutDirection, nextCounter);
    }
    return nextCounter;
};

export const assignEdgeBftNumbers = (ctx) => {
    const {
        viewGraph = null,
        layoutDirection = 'horizontal',
        displayGraph = null
    } = ctx || {};

    if (!isViewGraphLike(viewGraph)) {
        if (displayGraph) {
            assignModelEdgeNumbersForDisplayGraph(displayGraph);
        }
        return;
    }

    clearAllViewEdgeNumbers(viewGraph);

    if (!displayGraph) {
        assignEdgeNumbersInScope(viewGraph, layoutDirection, 1);
        return;
    }

    let counter = assignMainEdgesWithCompiledDive(displayGraph, viewGraph, layoutDirection, 1);
    counter = assignFragShellEdgesAfterMain(displayGraph, viewGraph, layoutDirection, counter);
};

export const resolveNodeBftNumber = (node) => {
    return node && node._bftNumber != null ? node._bftNumber : null;
};

export const locateBftNodeInGraph = (rootGraph, targetNode) => {
    if (!rootGraph || !targetNode) {
        return null;
    }
    const walk = (graph, ancestors) => {
        if (!graph) {
            return null;
        }
        if ((graph.nodes || []).includes(targetNode)) {
            return { graph, ancestors };
        }
        for (const shell of graph.nodes || []) {
            const nestedGraphs = [];
            const compiled = getCompiledGraphFromNode(shell);
            const subgraph = getSubgraphGraphFromNode(shell);
            if (compiled) {
                nestedGraphs.push(compiled);
            }
            if (subgraph && subgraph !== compiled) {
                nestedGraphs.push(subgraph);
            }
            for (const nestedGraph of nestedGraphs) {
                const found = walk(nestedGraph, ancestors.concat({ shell, graph: nestedGraph }));
                if (found) {
                    return found;
                }
            }
        }
        return null;
    };
    return walk(rootGraph, []);
};

export const formatBftNodeLocation = (rootGraph, node) => {
    const location = locateBftNodeInGraph(rootGraph, node);
    if (!location || location.ancestors.length === 0) {
        return null;
    }
    return location.ancestors
        .map((entry) => entry.shell.name || entry.shell.type?.name || 'subgraph')
        .join(' / ');
};

const collectMainScopeGraphs = (rootGraph, graphs = new Set()) => {
    if (!rootGraph || graphs.has(rootGraph)) {
        return graphs;
    }
    graphs.add(rootGraph);
    for (const node of rootGraph.nodes || []) {
        // Node numbers live on the main graph and on Frag/UserDef `graph`
        // bodies — never inside compiled_prim_graph.
        const subgraph = getMainScopeSubgraphFromNode(node);
        if (subgraph) {
            collectMainScopeGraphs(subgraph, graphs);
        }
    }
    return graphs;
};

export const collectBftSearchScopes = (rootGraph) => {
    if (!rootGraph) {
        return [];
    }
    const rootName = rootGraph.name || 'Graph';
    return [{
        id: 'root',
        kind: 'main',
        graph: rootGraph,
        label: `${rootName} (main graph)`
    }];
};

export const getBftOrderRangeForGraph = (graph) => {
    if (!graph) {
        return null;
    }
    let max = 0;
    for (const node of graph.nodes || []) {
        if (node._bftNumber != null) {
            max = Math.max(max, node._bftNumber);
        }
    }
    return max > 0 ? { min: 1, max } : null;
};

export const getBftOrderRange = (graph) => {
    if (!graph) {
        return null;
    }
    let max = 0;
    for (const nested of collectNestedGraphs(graph)) {
        for (const node of nested.nodes || []) {
            if (node._bftNumber != null) {
                max = Math.max(max, node._bftNumber);
            }
        }
    }
    return max > 0 ? { min: 1, max } : null;
};

export const findNodeByBftOrderInGraph = (graph, order) => {
    if (!graph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    return (graph.nodes || []).find((entry) => entry._bftNumber === order) || null;
};

export const getBftOrderRangeForMainScope = (rootGraph) => {
    if (!rootGraph) {
        return null;
    }
    let max = 0;
    for (const graph of collectMainScopeGraphs(rootGraph)) {
        for (const node of graph.nodes || []) {
            if (node._bftNumber != null) {
                max = Math.max(max, node._bftNumber);
            }
        }
    }
    return max > 0 ? { min: 1, max } : null;
};

export const findNodeByBftOrderInMainScope = (rootGraph, order) => {
    if (!rootGraph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    for (const graph of collectMainScopeGraphs(rootGraph)) {
        const node = findNodeByBftOrderInGraph(graph, order);
        if (node) {
            return node;
        }
    }
    return null;
};

const normalizeBftSearchScope = (rootGraph, scope) => {
    if (scope && typeof scope === 'object' && scope.id != null) {
        return scope;
    }
    if (scope === rootGraph) {
        return { id: 'root', kind: 'main', graph: rootGraph };
    }
    return { id: 'compiled', kind: 'compiled_prim_graph', graph: scope };
};

export const getBftOrderRangeForScope = (rootGraph, scope) => {
    const resolved = normalizeBftSearchScope(rootGraph, scope);
    if (!resolved) {
        return null;
    }
    if (resolved.kind === 'main' || resolved.id === 'root') {
        return getBftOrderRangeForMainScope(rootGraph);
    }
    return getBftOrderRangeForGraph(resolved.graph);
};

export const findNodeByBftOrderInScope = (rootGraph, scope, order) => {
    const resolved = normalizeBftSearchScope(rootGraph, scope);
    if (!resolved) {
        return null;
    }
    if (resolved.kind === 'main' || resolved.id === 'root') {
        return findNodeByBftOrderInMainScope(rootGraph, order);
    }
    return findNodeByBftOrderInGraph(resolved.graph, order);
};

export const findNodeByBftOrder = (graph, order) => {
    if (!graph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    for (const nested of collectNestedGraphs(graph)) {
        const node = findNodeByBftOrderInGraph(nested, order);
        if (node) {
            return node;
        }
    }
    return null;
};

export const parseBftOrderQuery = (text, rootGraph, scope = null) => {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return { ok: false, error: 'Enter an order number.' };
    }
    if (!/^\d+$/.test(trimmed)) {
        return { ok: false, error: 'Enter a positive whole number.' };
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value <= 0) {
        return { ok: false, error: 'Enter a positive whole number.' };
    }
    const resolvedScope = normalizeBftSearchScope(rootGraph, scope ?? rootGraph);
    const range = getBftOrderRangeForScope(rootGraph, resolvedScope);
    if (!range) {
        return { ok: false, error: 'No order numbers in this graph.' };
    }
    if (value < range.min || value > range.max) {
        return { ok: false, error: `Order must be between ${range.min} and ${range.max}.` };
    }
    const node = findNodeByBftOrderInScope(rootGraph, resolvedScope, value);
    if (!node) {
        return { ok: false, error: `No node with order ${value}.` };
    }
    return { ok: true, value, node };
};

const findHostNodeForCompiledPrimGraph = (graph, targetCompiled) => {
    if (!graph || !targetCompiled) {
        return null;
    }
    for (const node of graph.nodes || []) {
        const compiled = getCompiledPrimGraphFromNode(node);
        if (compiled === targetCompiled) {
            return node;
        }
        const subgraph = getSubgraphGraphFromNode(node);
        if (subgraph) {
            const nestedHost = findHostNodeForCompiledPrimGraph(subgraph, targetCompiled);
            if (nestedHost) {
                return nestedHost;
            }
        }
        if (compiled) {
            const nestedHost = findHostNodeForCompiledPrimGraph(compiled, targetCompiled);
            if (nestedHost) {
                return nestedHost;
            }
        }
    }
    return null;
};

export const collectBftConnectionSearchScopes = (rootModelGraph, paneViewGraph) => {
    return collectBftSearchScopes(rootModelGraph).map((scope) => {
        if (scope.kind === 'main') {
            return {
                ...scope,
                viewGraph: paneViewGraph
            };
        }
        const host = scope.hostNode || findHostNodeForCompiledPrimGraph(rootModelGraph, scope.graph);
        const scopedViewGraph = host && paneViewGraph ?
            findNestedViewGraphForHost(paneViewGraph, host) :
            null;
        return {
            ...scope,
            viewGraph: scopedViewGraph
        };
    });
};

export const getBftEdgeOrderRangeForViewGraph = (viewGraph) => {
    if (!viewGraph) {
        return null;
    }
    let max = 0;
    for (const edge of collectViewEdges(viewGraph)) {
        if (edge._bftEdgeNumber != null) {
            max = Math.max(max, edge._bftEdgeNumber);
        }
    }
    return max > 0 ? { min: 1, max } : null;
};

export const findEdgeByBftOrderInViewGraph = (viewGraph, order) => {
    if (!viewGraph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    return collectViewEdges(viewGraph).find((edge) => edge._bftEdgeNumber === order) || null;
};

const walkMainScopeViewGraphs = (paneViewGraph, modelGraph, visitor) => {
    if (!paneViewGraph || !modelGraph) {
        return;
    }
    visitor(paneViewGraph);
    const walk = (graph) => {
        for (const node of graph.nodes || []) {
            const subgraph = getMainScopeSubgraphFromNode(node);
            const compiled = getCompiledPrimGraphFromNode(node);
            if (subgraph) {
                const subgraphViewGraph = findNestedViewGraphForModelGraph(paneViewGraph, subgraph);
                if (subgraphViewGraph) {
                    visitor(subgraphViewGraph);
                }
                walk(subgraph);
            }
            if (compiled) {
                const compiledViewGraph = findNestedViewGraphForModelGraph(paneViewGraph, compiled);
                if (compiledViewGraph) {
                    visitor(compiledViewGraph);
                }
                walk(compiled);
            }
        }
    };
    walk(modelGraph);
};

export const getBftEdgeOrderRangeForModelGraph = (modelGraph) => {
    if (!modelGraph) {
        return null;
    }
    let max = 0;
    forEachTensorInGraph(modelGraph, (tensor) => {
        if (tensor._bftEdgeNumber != null) {
            max = Math.max(max, tensor._bftEdgeNumber);
        }
    });
    return max > 0 ? { min: 1, max } : null;
};

export const findTensorByBftOrderInModelGraph = (modelGraph, order) => {
    if (!modelGraph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    let found = null;
    forEachTensorInGraph(modelGraph, (tensor) => {
        if (tensor._bftEdgeNumber === order) {
            found = tensor;
        }
    });
    return found;
};

export const getBftEdgeOrderRangeForMainScopeFromModel = (rootModelGraph) => {
    if (!rootModelGraph) {
        return null;
    }
    let max = 0;
    for (const graph of collectNestedGraphs(rootModelGraph)) {
        const range = getBftEdgeOrderRangeForModelGraph(graph);
        if (range) {
            max = Math.max(max, range.max);
        }
    }
    return max > 0 ? { min: 1, max } : null;
};

export const findTensorByBftOrderInMainScopeFromModel = (rootModelGraph, order) => {
    if (!rootModelGraph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    for (const graph of collectNestedGraphs(rootModelGraph)) {
        const tensor = findTensorByBftOrderInModelGraph(graph, order);
        if (tensor) {
            return tensor;
        }
    }
    return null;
};

export const findModelGraphContainingTensor = (rootModelGraph, tensor) => {
    if (!rootModelGraph || !tensor) {
        return null;
    }
    for (const graph of collectNestedGraphs(rootModelGraph)) {
        let found = false;
        forEachTensorInGraph(graph, (candidate) => {
            if (candidate === tensor || (tensor.name && candidate.name === tensor.name)) {
                found = true;
            }
        });
        if (found) {
            return graph;
        }
    }
    return null;
};

export const findViewEdgeForModelTensorInScope = (
    rootModelGraph, paneViewGraph, scope, tensor, modelGraphHint = null
) => {
    if (!tensor) {
        return null;
    }
    const resolved = normalizeBftSearchScope(rootModelGraph, scope);
    const matchesTensor = (edge) => {
        const edgeTensor = edge.value && edge.value.value;
        return edgeTensor === tensor ||
            (tensor.name && edgeTensor && edgeTensor.name === tensor.name);
    };
    if (modelGraphHint && paneViewGraph) {
        const scopedViewGraph = findNestedViewGraphForModelGraph(paneViewGraph, modelGraphHint);
        if (scopedViewGraph) {
            const edge = collectViewEdges(scopedViewGraph).find(matchesTensor);
            if (edge) {
                return edge;
            }
        }
    }
    if (resolved.kind === 'compiled_prim_graph') {
        const scopedViewGraph = resolved.viewGraph ||
            (resolved.graph && paneViewGraph ?
                findNestedViewGraphForModelGraph(paneViewGraph, resolved.graph) :
                null) ||
            (resolved.hostNode && paneViewGraph ?
                findNestedViewGraphForHost(paneViewGraph, resolved.hostNode) :
                null);
        if (scopedViewGraph) {
            return collectViewEdges(scopedViewGraph).find(matchesTensor) || null;
        }
        return null;
    }
    let found = null;
    walkMainScopeViewGraphs(paneViewGraph, rootModelGraph, (viewGraph) => {
        if (!found) {
            found = collectViewEdges(viewGraph).find(matchesTensor) || null;
        }
    });
    return found;
};

export const isBftModelTensorConnection = (hit) => Boolean(hit && hit._modelTensor);

const wrapModelTensorConnection = (tensor) => (
    tensor ? { _modelTensor: tensor } : null
);

export const getBftEdgeOrderRangeForMainScope = (paneViewGraph, rootModelGraph) => {
    let max = 0;
    if (paneViewGraph) {
        walkMainScopeViewGraphs(paneViewGraph, rootModelGraph, (viewGraph) => {
            const range = getBftEdgeOrderRangeForViewGraph(viewGraph);
            if (range) {
                max = Math.max(max, range.max);
            }
        });
    }
    const modelRange = getBftEdgeOrderRangeForMainScopeFromModel(rootModelGraph);
    if (modelRange) {
        max = Math.max(max, modelRange.max);
    }
    return max > 0 ? { min: 1, max } : null;
};

export const findEdgeByBftOrderInMainScope = (paneViewGraph, rootModelGraph, order) => {
    if (!rootModelGraph || !Number.isInteger(order) || order <= 0) {
        return null;
    }
    if (paneViewGraph) {
        let found = null;
        walkMainScopeViewGraphs(paneViewGraph, rootModelGraph, (viewGraph) => {
            if (!found) {
                found = findEdgeByBftOrderInViewGraph(viewGraph, order);
            }
        });
        if (found) {
            return found;
        }
    }
    return wrapModelTensorConnection(findTensorByBftOrderInMainScopeFromModel(rootModelGraph, order));
};

export const getBftEdgeOrderRangeForScope = (rootModelGraph, paneViewGraph, scope) => {
    const resolved = normalizeBftSearchScope(rootModelGraph, scope);
    if (!resolved) {
        return null;
    }
    const viewGraph = resolved.viewGraph ?? paneViewGraph;
    if (resolved.kind === 'main' || resolved.id === 'root') {
        return getBftEdgeOrderRangeForMainScope(viewGraph, rootModelGraph);
    }
    if (resolved.viewGraph) {
        return getBftEdgeOrderRangeForViewGraph(resolved.viewGraph);
    }
    return getBftEdgeOrderRangeForModelGraph(resolved.graph);
};

export const findEdgeByBftOrderInScope = (rootModelGraph, scope, order) => {
    const resolved = normalizeBftSearchScope(rootModelGraph, scope);
    if (!resolved) {
        return null;
    }
    const viewGraph = resolved.viewGraph;
    if (resolved.kind === 'main' || resolved.id === 'root') {
        return findEdgeByBftOrderInMainScope(viewGraph, rootModelGraph, order);
    }
    if (viewGraph) {
        const edge = findEdgeByBftOrderInViewGraph(viewGraph, order);
        if (edge) {
            return edge;
        }
    }
    return wrapModelTensorConnection(findTensorByBftOrderInModelGraph(resolved.graph, order));
};

export const formatBftEdgeLabel = (edge) => {
    if (!edge) {
        return 'connection';
    }
    const tensor = edge.value && edge.value.value;
    const tensorName = tensor && tensor.name ? tensor.name : 'connection';
    const fromName = edge.from && (edge.from.value?.name || edge.from.class || '?');
    const toName = edge.to && (edge.to.value?.name || edge.to.class || '?');
    return `${tensorName} (${fromName} \u2192 ${toName})`;
};

export const parseBftEdgeOrderQuery = (text, rootModelGraph, scope) => {
    const trimmed = (text || '').trim();
    const resolvedScope = normalizeBftSearchScope(rootModelGraph, scope);
    const scopeLabel = resolvedScope?.label || 'this graph';
    const viewGraph = resolvedScope.viewGraph;
    if (!trimmed) {
        return { ok: false, error: 'Enter an order number.' };
    }
    if (!/^\d+$/.test(trimmed)) {
        return { ok: false, error: 'Enter a positive whole number.' };
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value <= 0) {
        return { ok: false, error: 'Enter a positive whole number.' };
    }
    const range = getBftEdgeOrderRangeForScope(rootModelGraph, viewGraph, resolvedScope);
    if (!range) {
        return { ok: false, error: `No connection orders in ${scopeLabel}.` };
    }
    if (value < range.min || value > range.max) {
        return { ok: false, error: `Order must be between ${range.min} and ${range.max}.` };
    }
    const hit = findEdgeByBftOrderInScope(rootModelGraph, resolvedScope, value);
    if (!hit) {
        return { ok: false, error: `No connection with order ${value}.` };
    }
    if (isBftModelTensorConnection(hit)) {
        const modelGraph = resolvedScope.kind === 'compiled_prim_graph' ?
            resolvedScope.graph :
            findModelGraphContainingTensor(rootModelGraph, hit._modelTensor) || rootModelGraph;
        return {
            ok: true,
            value,
            edge: null,
            tensor: hit._modelTensor,
            modelGraph 
        };
    }
    return { ok: true, value, edge: hit, tensor: null, modelGraph: null };
};

export const resolveEdgeBftNumber = (value) => {
    return value && value._bftEdgeNumber != null ? value._bftEdgeNumber : null;
};

const forEachTensorInGraph = (graph, callback) => {
    if (!graph) {
        return;
    }
    for (const input of graph.inputs || []) {
        for (const value of argumentValues(input)) {
            if (value) {
                callback(value);
            }
        }
    }
    for (const output of graph.outputs || []) {
        for (const value of argumentValues(output)) {
            if (value) {
                callback(value);
            }
        }
    }
    for (const node of graph.nodes || []) {
        for (const input of node.inputs || []) {
            for (const value of argumentValues(input)) {
                if (value) {
                    callback(value);
                }
            }
        }
        for (const output of node.outputs || []) {
            for (const value of argumentValues(output)) {
                if (value) {
                    callback(value);
                }
            }
        }
    }
};

export const resolveSidebarBftValue = (value, graphRoots) => {
    if (!value || value._bftEdgeNumber != null) {
        return value;
    }
    for (const root of graphRoots || []) {
        if (!root) {
            continue;
        }
        for (const graph of collectNestedGraphs(root)) {
            let match = null;
            forEachTensorInGraph(graph, (tensor) => {
                if (tensor === value || (value.name && tensor.name === value.name)) {
                    if (tensor._bftEdgeNumber != null) {
                        match = tensor;
                    }
                }
            });
            if (match) {
                return match;
            }
        }
    }
    return value;
};

export const nodeIsInDisplayedGraph = (node, displayGraph) => {
    if (!node || !displayGraph || !Array.isArray(displayGraph.nodes)) {
        return false;
    }
    return displayGraph.nodes.includes(node);
};

const pickLowestBftNode = (entries) => {
    let best = null;
    let bestOrder = Infinity;
    let fallback = null;
    for (const entry of entries) {
        const node = entry && entry.node;
        if (!node) {
            continue;
        }
        if (!fallback) {
            fallback = node;
        }
        const order = resolveNodeBftNumber(node);
        if (order != null && order < bestOrder) {
            best = node;
            bestOrder = order;
        }
    }
    return best || fallback;
};

export const resolveTensorSourceNode = (displayGraph, tensorName, role) => {
    if (!displayGraph || !tensorName) {
        return null;
    }
    const value = { name: tensorName };
    if (role === 'output') {
        return pickLowestBftNode(
            findValueProducers(displayGraph, value).filter((entry) => entry.node)
        );
    }
    return pickLowestBftNode(
        findValueConsumers(displayGraph, value).filter((entry) => entry.node)
    );
};


const modelConsumerEdgeCount = (modelGraph, tensor, nodeSet) => {
    let count = 0;
    for (const entry of findValueConsumers(modelGraph, tensor)) {
        if (entry.graphOutput) {
            count++;
        } else if (entry.node && nodeSet.has(entry.node)) {
            count++;
        }
    }
    return count;
};

const lowestNodeConsumerSortKey = (modelGraph, tensor, nodeSet) => {
    let best = Infinity;
    for (const entry of findValueConsumers(modelGraph, tensor)) {
        if (!entry.node || !nodeSet.has(entry.node)) {
            continue;
        }
        if (entry.node._bftNumber != null) {
            best = Math.min(best, entry.node._bftNumber);
        }
    }
    return best;
};

// Count one id per consumer edge (including graph-output terminals), matching
// expanded view numbering. Orphan node outputs (no consumers) reserve one id,
// matching view._promoteOrphanOutputTerminals.
const assignModelGraphEdgeNumbersInScope = (modelGraph, counter, options = {}) => {
    if (!modelGraph) {
        return counter;
    }
    const { reserveSharedInputs = false } = options;
    let nextCounter = counter;
    const seen = new Set();
    const nodes = modelGraph.nodes || [];
    const nodeSet = new Set(nodes);

    const markSameNameGraphOutputs = (name) => {
        if (!name) {
            return;
        }
        for (const output of modelGraph.outputs || []) {
            for (const value of argumentValues(output)) {
                if (value && value.name === name) {
                    seen.add(value);
                }
            }
        }
    };

    const inputConnections = [];
    for (const input of modelGraph.inputs || []) {
        for (const tensor of argumentValues(input)) {
            if (!tensor || seen.has(tensor)) {
                continue;
            }
            if (tensor._bftEdgeNumber != null && !reserveSharedInputs) {
                continue;
            }
            const edgeCount = modelConsumerEdgeCount(modelGraph, tensor, nodeSet);
            if (edgeCount === 0) {
                continue;
            }
            seen.add(tensor);
            markSameNameGraphOutputs(tensor.name);
            inputConnections.push({
                tensor,
                alreadyNumbered: tensor._bftEdgeNumber != null,
                edgeCount,
                sortKey: lowestNodeConsumerSortKey(modelGraph, tensor, nodeSet)
            });
        }
    }
    inputConnections.sort((a, b) => a.sortKey - b.sortKey);
    for (const entry of inputConnections) {
        if (!entry.alreadyNumbered) {
            entry.tensor._bftEdgeNumber = nextCounter;
        }
        nextCounter += entry.edgeCount;
    }

    const outputConnections = [];
    for (const node of nodes) {
        for (const output of node.outputs || []) {
            for (const tensor of argumentValues(output)) {
                if (!tensor || tensor._bftEdgeNumber != null || seen.has(tensor)) {
                    continue;
                }
                let edgeCount = modelConsumerEdgeCount(modelGraph, tensor, nodeSet);
                if (edgeCount === 0) {
                    edgeCount = 1;
                }
                seen.add(tensor);
                markSameNameGraphOutputs(tensor.name);
                outputConnections.push({
                    tensor,
                    edgeCount,
                    sortKey: node._bftNumber != null ? node._bftNumber : Infinity
                });
            }
        }
    }
    outputConnections.sort((a, b) => a.sortKey - b.sortKey);
    for (const entry of outputConnections) {
        entry.tensor._bftEdgeNumber = nextCounter;
        nextCounter += entry.edgeCount;
    }

    for (const output of modelGraph.outputs || []) {
        for (const tensor of argumentValues(output)) {
            if (!tensor || tensor._bftEdgeNumber != null || seen.has(tensor)) {
                continue;
            }
            seen.add(tensor);
            tensor._bftEdgeNumber = nextCounter++;
        }
    }
    return nextCounter;
};

const assignModelEdgeNumbersForDisplayGraph = (displayGraph) => {
    if (!displayGraph) {
        return;
    }
    let counter = assignModelGraphEdgeNumbersInScope(displayGraph, 1);

    const assignNestedFromHosts = (graph, includeFragShells) => {
        const hosts = (graph.nodes || []).filter((node) => {
            const hasNested = getCompiledPrimGraphFromNode(node) || getSubgraphGraphFromNode(node);
            if (!hasNested) {
                return false;
            }
            return includeFragShells ? isFragShellHost(node) : !isFragShellHost(node);
        });
        const entries = hosts.map((node, index) => ({
            node,
            view: null,
            fallbackIndex: index
        }));
        for (const entry of sortEntriesByVisualPosition(entries, 'horizontal')) {
            for (const nested of hostNestedModelGraphs(entry.node)) {
                counter = assignModelGraphEdgeNumbersInScope(nested, counter, {
                    reserveSharedInputs: true
                });
                assignNestedFromHosts(nested, false);
                assignNestedFromHosts(nested, true);
            }
        }
    };

    assignNestedFromHosts(displayGraph, false);
    assignNestedFromHosts(displayGraph, true);
};

export const formatBftModelTensorLabel = (tensor, modelGraph) => {
    if (!tensor || !tensor.name) {
        return 'connection';
    }
    const fromNode = resolveTensorSourceNode(modelGraph, tensor.name, 'output');
    const toNode = resolveTensorSourceNode(modelGraph, tensor.name, 'input');
    const fromName = fromNode?.name || fromNode?.type?.name || '?';
    const toName = toNode?.name || toNode?.type?.name || '?';
    return `${tensor.name} (${fromName} \u2192 ${toName})`;
};

export const formatTensorWithSourceNodeId = (tensorName, displayGraph, role) => {
    if (!tensorName) {
        return '';
    }
    const node = resolveTensorSourceNode(displayGraph, tensorName, role);
    const nodeId = resolveNodeBftNumber(node);
    if (nodeId == null) {
        return tensorName;
    }
    return `${tensorName} | sourceNodeId: ${nodeId}`;
};

export const ensureBftNumbersForDisplayGraph = (displayGraph, layoutDirection = 'horizontal') => {
    if (!displayGraph) {
        return null;
    }
    const hasNumbers = (displayGraph.nodes || []).some((node) => node._bftNumber != null);
    if (hasNumbers) {
        return displayGraph;
    }
    const viewGraph = {
        find(node) {
            const index = (displayGraph.nodes || []).indexOf(node);
            if (index < 0) {
                return null;
            }
            if (layoutDirection === 'vertical') {
                return { x: 0, y: index };
            }
            return { x: index, y: 0 };
        },
        edges: new Map()
    };
    assignBftNumbers({
        displayGraph,
        sourceGraph: displayGraph,
        viewGraph,
        layoutDirection
    });
    return displayGraph;
};