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

const isRestartCompiledHost = (node) => (
    node.type?.name === 'CVFlowNVP'
);

const collectCompiledGraphHosts = (graph) => {
    return (graph.nodes || []).filter((node) => getCompiledGraphFromNode(node));
};

const graphHasCompiledGraphHosts = (graph) => {
    return collectCompiledGraphHosts(graph).length > 0;
};

const assignNestedCompiledHosts = (graph, viewGraph, nodeCounter, layoutDirection) => {
    const entries = collectCompiledGraphHosts(graph).map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let nextCounter = nodeCounter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
        const subGraph = getCompiledGraphFromNode(entry.node);
        if (!subGraph) {
            continue;
        }
        const restart = isRestartCompiledHost(entry.node);
        const startCounter = restart ? 1 : nextCounter;
        const endCounter = assignNumbersToGraphNodes(subGraph, viewGraph, startCounter, {
            assignUnreachableAtEnd: !restart,
            entryOnlySources: true,
            layoutDirection
        });
        assignNestedCompiledHosts(subGraph, viewGraph, endCounter, layoutDirection);
        if (!restart) {
            nextCounter = endCounter;
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
            assignUnreachableAtEnd: compiledLike,
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

const assignNestedCompiledHostEdges = (modelGraph, viewGraph, layoutDirection, counter) => {
    const entries = collectCompiledGraphHosts(modelGraph).map((node, index) => ({
        node,
        view: findViewNode(viewGraph, node),
        fallbackIndex: index
    }));
    let nextCounter = counter;
    for (const entry of sortEntriesByVisualPosition(entries, layoutDirection)) {
        const nestedViewGraph = findNestedViewGraphForHost(viewGraph, entry.node);
        if (!nestedViewGraph) {
            continue;
        }
        if (isRestartCompiledHost(entry.node)) {
            assignEdgeNumbersInScope(nestedViewGraph, layoutDirection, 1);
        } else {
            nextCounter = assignEdgeNumbersInScope(nestedViewGraph, layoutDirection, nextCounter);
        }
        const subGraph = getCompiledGraphFromNode(entry.node);
        if (subGraph) {
            nextCounter = assignNestedCompiledHostEdges(subGraph, viewGraph, layoutDirection, nextCounter);
        }
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
        return;
    }

    clearAllViewEdgeNumbers(viewGraph);

    let counter = assignEdgeNumbersInScope(viewGraph, layoutDirection, 1);
    if (displayGraph) {
        counter = assignNestedCompiledHostEdges(displayGraph, viewGraph, layoutDirection, counter);
    }
};

export const resolveNodeBftNumber = (node) => {
    return node && node._bftNumber != null ? node._bftNumber : null;
};

export const locateBftNodeInGraph = (rootGraph, targetNode) => {
    if (!rootGraph || !targetNode) {
        return null;
    }
    const walk = (graph, ancestors) => {
        if ((graph.nodes || []).includes(targetNode)) {
            return { graph, ancestors };
        }
        for (const shell of graph.nodes || []) {
            const compiled = getCompiledGraphFromNode(shell);
            if (!compiled) {
                continue;
            }
            const found = walk(compiled, ancestors.concat({ shell, graph: compiled }));
            if (found) {
                return found;
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

export const collectBftSearchScopes = (rootGraph) => {
    const scopes = [];
    const walk = (graph, idPath, labelParts) => {
        scopes.push({
            id: idPath.join('/'),
            graph,
            label: labelParts.join(' / ')
        });
        for (const node of graph.nodes || []) {
            const compiled = getCompiledGraphFromNode(node);
            if (!compiled) {
                continue;
            }
            const hostName = node.name || node.type?.name || 'subgraph';
            const attrName = getCompiledGraphAttrName(node) || 'compiled_prim_graph';
            const graphName = compiled.name || attrName;
            walk(
                compiled,
                idPath.concat([hostName, graphName]),
                labelParts.concat([`${hostName} \u203A ${graphName}`])
            );
        }
    };
    if (!rootGraph) {
        return scopes;
    }
    const rootName = rootGraph.name || 'Graph';
    walk(rootGraph, ['root'], [`${rootName} (main graph)`]);
    return scopes;
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

export const parseBftOrderQuery = (text, rootGraph, scopeGraph = rootGraph) => {
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
    const searchGraph = scopeGraph || rootGraph;
    const range = getBftOrderRangeForGraph(searchGraph);
    if (!range) {
        return { ok: false, error: 'No order numbers in this graph.' };
    }
    if (value < range.min || value > range.max) {
        return { ok: false, error: `Order must be between ${range.min} and ${range.max}.` };
    }
    const node = findNodeByBftOrderInGraph(searchGraph, value);
    if (!node) {
        return { ok: false, error: `No node with order ${value}.` };
    }
    return { ok: true, value, node };
};

const findHostNodeForCompiledGraph = (graph, targetCompiled) => {
    if (!graph || !targetCompiled) {
        return null;
    }
    for (const node of graph.nodes || []) {
        const compiled = getCompiledGraphFromNode(node);
        if (!compiled) {
            continue;
        }
        if (compiled === targetCompiled) {
            return node;
        }
        const nestedHost = findHostNodeForCompiledGraph(compiled, targetCompiled);
        if (nestedHost) {
            return nestedHost;
        }
    }
    return null;
};

export const collectBftConnectionSearchScopes = (rootModelGraph, paneViewGraph) => {
    return collectBftSearchScopes(rootModelGraph).map((scope) => {
        let scopedViewGraph = paneViewGraph;
        if (scope.id !== 'root') {
            const host = findHostNodeForCompiledGraph(rootModelGraph, scope.graph);
            scopedViewGraph = host && paneViewGraph ?
                findNestedViewGraphForHost(paneViewGraph, host) :
                null;
        }
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

export const parseBftEdgeOrderQuery = (text, scopeViewGraph, scopeLabel = 'this graph') => {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return { ok: false, error: 'Enter an order number.' };
    }
    if (!scopeViewGraph) {
        return { ok: false, error: `Expand the block to search connections in ${scopeLabel}.` };
    }
    if (!/^\d+$/.test(trimmed)) {
        return { ok: false, error: 'Enter a positive whole number.' };
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value <= 0) {
        return { ok: false, error: 'Enter a positive whole number.' };
    }
    const range = getBftEdgeOrderRangeForViewGraph(scopeViewGraph);
    if (!range) {
        return { ok: false, error: `No connection orders in ${scopeLabel}.` };
    }
    if (value < range.min || value > range.max) {
        return { ok: false, error: `Order must be between ${range.min} and ${range.max}.` };
    }
    const edge = findEdgeByBftOrderInViewGraph(scopeViewGraph, value);
    if (!edge) {
        return { ok: false, error: `No connection with order ${value}.` };
    }
    return { ok: true, value, edge };
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
    for (const entry of entries) {
        const node = entry && entry.node;
        const order = resolveNodeBftNumber(node);
        if (node && order != null && order < bestOrder) {
            best = node;
            bestOrder = order;
        }
    }
    return best;
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