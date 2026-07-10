/*
 * Tests for BFT numbering logic.
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isCompactNodeWidth,
    headerTitleTextWidth,
    headerNeedsBftLabelGutter,
    BFT_HEADER_TITLE_MAJORITY
} from '../source/grapher.js';
import {
    formatTensorWithSourceNodeId,
    resolveTensorSourceNode,
    ensureBftNumbersForDisplayGraph,
    assignBftNumbers,
    clearBftMetadata,
    getCompiledGraphFromNode,
    nodeIsInDisplayedGraph,
    resolveAmbapbNumberingMode,
    resolveSidebarBftValue
} from '../source/ambapb-bft-numbering.js';
import { applyBatchInlineExpansions, inlineExpansionBatchCallName } from '../source/ambapb-batch-inline.js';

const tensor = (name) => ({ name, type: 'float32' });

const buildLinearGraph = () => ({
    name: 'main',
    inputs: [{ name: 'input', value: [tensor('graph_in')] }],
    outputs: [{ name: 'output', value: [tensor('graph_out')] }],
    nodes: [
        {
            name: 'a',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('graph_in')] }],
            outputs: [{ name: 'y', value: [tensor('a_out')] }]
        },
        {
            name: 'b',
            type: { name: 'Relu' },
            inputs: [{ name: 'x', value: [tensor('a_out')] }],
            outputs: [{ name: 'y', value: [tensor('b_out')] }]
        },
        {
            name: 'c',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('b_out')] }],
            outputs: [{ name: 'y', value: [tensor('graph_out')] }]
        }
    ]
});

const mockViewGraph = (positions, edges = new Map()) => ({
    find(node) {
        return positions.get(node) || null;
    },
    edges
});

const mockNodeView = (model, x, y, className = 'graph-node') => ({
    value: model,
    class: className,
    x,
    y,
    name: model.name || `${x}:${y}`
});

const mockInputView = (inputArg, x, y) => ({
    value: inputArg,
    class: 'graph-input',
    x,
    y,
    name: `input-${inputArg.name}`
});

const mockOutputView = (outputArg, x, y) => ({
    value: outputArg,
    class: 'graph-output',
    x,
    y,
    name: `output-${outputArg.name}`
});

const mockEdge = (from, to, tensorValue) => ({
    from,
    to,
    value: tensorValue ? { value: tensorValue } : null
});

const registerEdge = (edgesMap, edge) => {
    const key = `${edge.from.name}:${edge.to.name}`;
    edgesMap.set(key, { v: edge.from, w: edge.to, label: edge });
    return edge;
};

const buildLinearViewEdges = (graph, positions) => {
    const edges = new Map();
    const graphIn = graph.inputs[0].value[0];
    const graphOut = graph.outputs[0].value[0];
    const nodeA = graph.nodes[0];
    const nodeB = graph.nodes[1];
    const nodeC = graph.nodes[2];
    const posA = positions.get(nodeA);
    const posB = positions.get(nodeB);
    const posC = positions.get(nodeC);
    const inputView = mockInputView(graph.inputs[0], -1, posA.y);
    const outputView = mockOutputView(graph.outputs[0], 3, posC.y);
    registerEdge(edges, mockEdge(
        inputView,
        mockNodeView(nodeA, posA.x, posA.y),
        graphIn
    ));
    registerEdge(edges, mockEdge(
        mockNodeView(nodeA, posA.x, posA.y),
        mockNodeView(nodeB, posB.x, posB.y),
        nodeA.outputs[0].value[0]
    ));
    registerEdge(edges, mockEdge(
        mockNodeView(nodeB, posB.x, posB.y),
        mockNodeView(nodeC, posC.x, posC.y),
        nodeB.outputs[0].value[0]
    ));
    registerEdge(edges, mockEdge(
        mockNodeView(nodeC, posC.x, posC.y),
        outputView,
        nodeC.outputs[0].value[0]
    ));
    return edges;
};

const buildDiamondViewEdges = (graph, positions, layoutDirection = 'horizontal') => {
    const edges = new Map();
    const root = graph.nodes[0];
    const left = graph.nodes[1];
    const right = graph.nodes[2];
    const merge = graph.nodes[3];
    const rootView = mockNodeView(root, positions.get(root).x, positions.get(root).y);
    const leftView = mockNodeView(left, positions.get(left).x, positions.get(left).y);
    const rightView = mockNodeView(right, positions.get(right).x, positions.get(right).y);
    const mergeView = mockNodeView(merge, positions.get(merge).x, positions.get(merge).y);
    registerEdge(edges, mockEdge(rootView, rightView, root.outputs[0].value[0]));
    registerEdge(edges, mockEdge(rootView, leftView, root.outputs[0].value[0]));
    registerEdge(edges, mockEdge(rightView, mergeView, right.outputs[0].value[0]));
    registerEdge(edges, mockEdge(leftView, mergeView, left.outputs[0].value[0]));
    return edges;
};

const buildDualInputViewEdges = (graph, positions) => {
    const edges = new Map();
    const leftInputArg = graph.inputs.find((input) => input.value[0].name === 'left_in');
    const rightInputArg = graph.inputs.find((input) => input.value[0].name === 'right_in');
    const leftEntry = graph.nodes.find((node) => node.name === 'left_entry');
    const rightEntry = graph.nodes.find((node) => node.name === 'right_entry');
    registerEdge(edges, mockEdge(
        mockInputView(leftInputArg, positions.get(leftInputArg).x, positions.get(leftInputArg).y),
        mockNodeView(leftEntry, positions.get(leftEntry).x, positions.get(leftEntry).y),
        leftInputArg.value[0]
    ));
    registerEdge(edges, mockEdge(
        mockInputView(rightInputArg, positions.get(rightInputArg).x, positions.get(rightInputArg).y),
        mockNodeView(rightEntry, positions.get(rightEntry).x, positions.get(rightEntry).y),
        rightInputArg.value[0]
    ));
    return edges;
};

describe('ambapb bft numbering', () => {
    it('numbers a linear graph in breadth-first order', () => {
        const graph = buildLinearGraph();
        clearBftMetadata(graph);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(new Map()),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[0]._bftNumber, 1);
        assert.equal(graph.nodes[1]._bftNumber, 2);
        assert.equal(graph.nodes[2]._bftNumber, 3);
        assert.equal(graph.inputs[0]._bftNumber, undefined);
        assert.equal(graph.outputs[0]._bftNumber, undefined);
    });

    it('sorts same-level nodes left to right by view position', () => {
        const graph = {
            name: 'fork',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'root',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('root_out')] }]
                },
                {
                    name: 'left',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('root_out')] }],
                    outputs: [{ name: 'y', value: [tensor('left_out')] }]
                },
                {
                    name: 'right',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('root_out')] }],
                    outputs: [{ name: 'y', value: [tensor('right_out')] }]
                }
            ]
        };
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 10 }],
            [graph.nodes[2], { x: 1, y: 0 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[0]._bftNumber, 1);
        assert.equal(graph.nodes[2]._bftNumber, 2);
        assert.equal(graph.nodes[1]._bftNumber, 3);
    });

    it('skips frag shells and numbers compiled subgraph nodes', () => {
        const innerA = {
            name: 'inner_a',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('sub_in')] }],
            outputs: [{ name: 'y', value: [tensor('inner_a_out')] }]
        };
        const innerB = {
            name: 'inner_b',
            type: { name: 'Relu' },
            inputs: [{ name: 'x', value: [tensor('inner_a_out')] }],
            outputs: [{ name: 'y', value: [tensor('sub_out')] }]
        };
        const compiled = {
            name: 'compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('sub_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('sub_out')] }],
            nodes: [innerA, innerB]
        };
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'main',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('main_out')] }]
                },
                {
                    name: 'frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: compiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        const innerEdges = new Map();
        registerEdge(innerEdges, mockEdge(
            mockNodeView(innerA, 0, 0),
            mockNodeView(innerB, 1, 0),
            innerA.outputs[0].value[0]
        ));
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(new Map([
                [graph.nodes[0], { x: 0, y: 0 }],
                [graph.nodes[1], { x: 1, y: 0 }],
                [innerA, { x: 0, y: 0 }],
                [innerB, { x: 1, y: 0 }]
            ]), innerEdges),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[1]._bftNumber, undefined);
        assert.equal(innerA._bftNumber, 2);
        assert.equal(innerB._bftNumber, 3);
        assert.equal(compiled.inputs[0].value[0]._bftEdgeNumber, undefined);
        assert.equal(innerA.outputs[0].value[0]._bftEdgeNumber, 1);
        assert.equal(compiled.outputs[0].value[0]._bftEdgeNumber, undefined);
        assert.equal(getCompiledGraphFromNode(graph.nodes[1]), compiled);
    });

    it('assigns unreachable frag nodes at the end left to right', () => {
        const orphan = {
            name: 'orphan',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('missing')] }],
            outputs: [{ name: 'y', value: [tensor('orphan_out')] }]
        };
        const connected = {
            name: 'connected',
            type: { name: 'Relu' },
            inputs: [{ name: 'x', value: [tensor('sub_in')] }],
            outputs: [{ name: 'y', value: [tensor('sub_out')] }]
        };
        const compiled = {
            name: 'compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('sub_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('sub_out')] }],
            nodes: [connected, orphan]
        };
        assignBftNumbers({
            displayGraph: compiled,
            sourceGraph: compiled,
            viewGraph: mockViewGraph(new Map([
                [connected, { x: 0, y: 5 }],
                [orphan, { x: 0, y: 0 }]
            ])),
            layoutDirection: 'horizontal'
        });
        assert.equal(connected._bftNumber, 1);
        assert.equal(orphan._bftNumber, 2);
    });

    it('sets wrapper numbers for inlined batch call nodes', () => {
        const inner = {
            name: 'inner_nvp',
            type: { name: 'CVFlowNVP' },
            inputs: [{ name: 'x', value: [tensor('sub_in')] }],
            outputs: [{ name: 'y', value: [tensor('sub_out')] }]
        };
        const compiled = {
            name: 'compiled',
            inputs: [{ name: 'sub_input', value: [tensor('sub_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('sub_out')] }],
            nodes: [inner]
        };
        const sourceGraph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'producer',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('producer_out')] }]
                },
                {
                    name: 'batch_call',
                    type: { name: 'BatchCall' },
                    attributes: [
                        { name: 'graph_id', type: 'string', value: 'compiled' },
                        { name: 'src_mappings', type: 'string', value: '[]' },
                        { name: 'out_mappings', type: 'string', value: '[]' }
                    ],
                    inputs: [{ name: 'x', value: [tensor('producer_out')] }],
                    outputs: [{ name: 'y', value: [tensor('batch_out')] }]
                },
                {
                    name: 'frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: compiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        const displayGraph = applyBatchInlineExpansions(sourceGraph, new Set(['batch_call']));
        assignBftNumbers({
            displayGraph,
            sourceGraph,
            viewGraph: mockViewGraph(new Map([
                [sourceGraph.nodes[0], { x: 0, y: 0 }],
                [displayGraph.nodes.find((node) => node._inlineExpanded), { x: 1, y: 0 }]
            ])),
            layoutDirection: 'horizontal'
        });
        const inlined = displayGraph.nodes.find((node) => node._inlineExpanded);
        const fragInner = getCompiledGraphFromNode(displayGraph.nodes.find((node) => node.name === 'frag')).nodes[0];
        assert.ok(inlined);
        assert.equal(inlineExpansionBatchCallName(inlined), 'batch_call');
        assert.equal(inlined._bftWrapperNumber, 2);
        assert.equal(inlined._bftNumber, 3);
        assert.equal(fragInner._bftNumber, 3);
    });

    it('numbers visible edges in traversal order', () => {
        const graph = buildLinearGraph();
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 0 }],
            [graph.nodes[2], { x: 2, y: 0 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, buildLinearViewEdges(graph, positions)),
            layoutDirection: 'horizontal'
        });
        const value1 = graph.nodes[0].outputs[0].value[0];
        const value2 = graph.nodes[1].outputs[0].value[0];
        assert.equal(graph.inputs[0].value[0]._bftEdgeNumber, 1);
        assert.equal(value1._bftEdgeNumber, 2);
        assert.equal(value2._bftEdgeNumber, 3);
        assert.equal(graph.nodes[2].outputs[0].value[0]._bftEdgeNumber, 4);
        assert.equal(graph.nodes[0]._bftNumber, 1);
        assert.equal(graph.nodes[1]._bftNumber, 2);
    });

    it('sorts same-level edges left to right by BFS visit order', () => {
        const graph = {
            name: 'diamond',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'root',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('root_out')] }]
                },
                {
                    name: 'left',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('root_out')] }],
                    outputs: [{ name: 'y', value: [tensor('left_out')] }]
                },
                {
                    name: 'right',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('root_out')] }],
                    outputs: [{ name: 'y', value: [tensor('right_out')] }]
                },
                {
                    name: 'merge',
                    type: { name: 'Add' },
                    inputs: [
                        { name: 'a', value: [tensor('left_out')] },
                        { name: 'b', value: [tensor('right_out')] }
                    ],
                    outputs: [{ name: 'y', value: [tensor('merge_out')] }]
                }
            ]
        };
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 10 }],
            [graph.nodes[2], { x: 1, y: 0 }],
            [graph.nodes[3], { x: 2, y: 0 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, buildDiamondViewEdges(graph, positions)),
            layoutDirection: 'horizontal'
        });
        const leftOut = graph.nodes[1].outputs[0].value[0];
        const rightOut = graph.nodes[2].outputs[0].value[0];
        const rootOut = graph.nodes[0].outputs[0].value[0];
        assert.equal(rootOut._bftEdgeNumber, 2);
        assert.equal(rightOut._bftEdgeNumber, 3);
        assert.equal(leftOut._bftEdgeNumber, 4);
    });

    it('sorts same-level edges top to bottom in vertical layout', () => {
        const graph = {
            name: 'diamond',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'root',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('root_out')] }]
                },
                {
                    name: 'top',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('root_out')] }],
                    outputs: [{ name: 'y', value: [tensor('top_out')] }]
                },
                {
                    name: 'bottom',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('root_out')] }],
                    outputs: [{ name: 'y', value: [tensor('bottom_out')] }]
                },
                {
                    name: 'merge',
                    type: { name: 'Add' },
                    inputs: [
                        { name: 'a', value: [tensor('top_out')] },
                        { name: 'b', value: [tensor('bottom_out')] }
                    ],
                    outputs: [{ name: 'y', value: [tensor('merge_out')] }]
                }
            ]
        };
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 0, y: 1 }],
            [graph.nodes[2], { x: 10, y: 1 }],
            [graph.nodes[3], { x: 5, y: 2 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, buildDiamondViewEdges(graph, positions, 'vertical')),
            layoutDirection: 'vertical'
        });
        const topOut = graph.nodes[1].outputs[0].value[0];
        const bottomOut = graph.nodes[2].outputs[0].value[0];
        const rootOut = graph.nodes[0].outputs[0].value[0];
        assert.equal(rootOut._bftEdgeNumber, 2);
        assert.equal(topOut._bftEdgeNumber, 3);
        assert.equal(bottomOut._bftEdgeNumber, 4);
    });

    it('numbers graph input and output terminal edges', () => {
        const graph = buildLinearGraph();
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 0 }],
            [graph.nodes[2], { x: 2, y: 0 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, buildLinearViewEdges(graph, positions)),
            layoutDirection: 'horizontal'
        });
        const graphIn = graph.inputs[0].value[0];
        const internalValue = graph.nodes[0].outputs[0].value[0];
        const outputEdgeValue = graph.nodes[2].outputs[0].value[0];
        assert.equal(graphIn._bftEdgeNumber, 1);
        assert.equal(internalValue._bftEdgeNumber, 2);
        assert.equal(outputEdgeValue._bftEdgeNumber, 4);
    });

    it('resolves sidebar connection order from numbered display graph roots', () => {
        const graph = buildLinearGraph();
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 0 }],
            [graph.nodes[2], { x: 2, y: 0 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, buildLinearViewEdges(graph, positions)),
            layoutDirection: 'horizontal'
        });
        const value = graph.nodes[0].outputs[0].value[0];
        const alias = { name: value.name };
        const resolved = resolveSidebarBftValue(alias, [graph]);
        assert.equal(resolved._bftEdgeNumber, 2);
    });

    it('detects when header title fills majority of header width', () => {
        const titleEntry = { textWidth: 120, width: 134, padding: 7, tx: 7 };
        assert.equal(headerTitleTextWidth(titleEntry), 120);

        const shortHeader = {
            width: 134,
            _entries: [titleEntry]
        };
        assert.equal(headerNeedsBftLabelGutter(shortHeader, 134), true);

        const longHeader = {
            width: 200,
            _entries: [{ textWidth: 40, width: 54, padding: 7, tx: 7 }]
        };
        assert.equal(headerNeedsBftLabelGutter(longHeader, 200), false);
    });


    it('seeds traversal from graph inputs left to right', () => {
        const leftInputArg = { name: 'left_input', value: [tensor('left_in')] };
        const rightInputArg = { name: 'right_input', value: [tensor('right_in')] };
        const leftEntry = {
            name: 'left_entry',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('left_in')] }],
            outputs: [{ name: 'y', value: [tensor('left_out')] }]
        };
        const rightEntry = {
            name: 'right_entry',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('right_in')] }],
            outputs: [{ name: 'y', value: [tensor('right_out')] }]
        };
        const graph = {
            name: 'dual_input',
            inputs: [rightInputArg, leftInputArg],
            outputs: [],
            nodes: [rightEntry, leftEntry]
        };
        const positions = new Map([
            [leftInputArg, { x: 0, y: 0 }],
            [rightInputArg, { x: 0, y: 10 }],
            [leftEntry, { x: 1, y: 0 }],
            [rightEntry, { x: 1, y: 10 }]
        ]);
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, buildDualInputViewEdges(graph, positions)),
            layoutDirection: 'horizontal'
        });
        assert.equal(leftEntry._bftNumber, 1);
        assert.equal(rightEntry._bftNumber, 2);
        assert.equal(graph.inputs.find((input) => input.value[0].name === 'left_in').value[0]._bftEdgeNumber, 1);
        assert.equal(graph.inputs.find((input) => input.value[0].name === 'right_in').value[0]._bftEdgeNumber, 2);
    });

    it('numbers multi-output nodes from left to right by consumer position', () => {
        const graph = {
            name: 'multi_out',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'split',
                    type: { name: 'Split' },
                    inputs: [{ name: 'x', value: [tensor('in')] }],
                    outputs: [
                        { name: 'a', value: [tensor('out_top')] },
                        { name: 'b', value: [tensor('out_bottom')] }
                    ]
                },
                {
                    name: 'top',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('out_top')] }],
                    outputs: [{ name: 'y', value: [tensor('top_done')] }]
                },
                {
                    name: 'bottom',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('out_bottom')] }],
                    outputs: [{ name: 'y', value: [tensor('bottom_done')] }]
                }
            ]
        };
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 0 }],
            [graph.nodes[2], { x: 1, y: 10 }]
        ]);
        const split = graph.nodes[0];
        const top = graph.nodes[1];
        const bottom = graph.nodes[2];
        const multiEdges = new Map();
        registerEdge(multiEdges, mockEdge(
            mockNodeView(split, 0, 0),
            mockNodeView(top, 1, 0),
            split.outputs[0].value[0]
        ));
        registerEdge(multiEdges, mockEdge(
            mockNodeView(split, 0, 0),
            mockNodeView(bottom, 1, 10),
            split.outputs[1].value[0]
        ));
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, multiEdges),
            layoutDirection: 'horizontal'
        });
        const outTop = graph.nodes[0].outputs[0].value[0];
        const outBottom = graph.nodes[0].outputs[1].value[0];
        assert.equal(outTop._bftEdgeNumber, 1);
        assert.equal(outBottom._bftEdgeNumber, 2);
    });

    it('does not leave gaps when a node has unused output slots', () => {
        const graph = {
            name: 'unused_output',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'producer',
                    type: { name: 'Split' },
                    inputs: [],
                    outputs: [
                        { name: 'used', value: [tensor('used_out')] },
                        { name: 'unused', value: [tensor('unused_out')] }
                    ]
                },
                {
                    name: 'consumer',
                    type: { name: 'Relu' },
                    inputs: [{ name: 'x', value: [tensor('used_out')] }],
                    outputs: [{ name: 'y', value: [tensor('done')] }]
                }
            ]
        };
        const positions = new Map([
            [graph.nodes[0], { x: 0, y: 0 }],
            [graph.nodes[1], { x: 1, y: 0 }]
        ]);
        const edges = new Map();
        registerEdge(edges, mockEdge(
            mockNodeView(graph.nodes[0], 0, 0),
            mockNodeView(graph.nodes[1], 1, 0),
            graph.nodes[0].outputs[0].value[0]
        ));
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(positions, edges),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[0].outputs[0].value[0]._bftEdgeNumber, 1);
        assert.equal(graph.nodes[0].outputs[1].value[0]._bftEdgeNumber, undefined);
    });

    it('detects compact nodes by measured width', () => {
        assert.equal(isCompactNodeWidth(40), true);
        assert.equal(isCompactNodeWidth(74), true);
        assert.equal(isCompactNodeWidth(75), false);
        assert.equal(isCompactNodeWidth(120), false);
    });

    it('knows whether a node is in the displayed graph', () => {
        const graph = buildLinearGraph();
        assert.equal(nodeIsInDisplayedGraph(graph.nodes[0], graph), true);
        assert.equal(nodeIsInDisplayedGraph({ name: 'other' }, graph), false);
    });

    it('numbers multiple frags left to right after the main graph', () => {
        const leftInner = {
            name: 'left_inner',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('left_in')] }],
            outputs: [{ name: 'y', value: [tensor('left_out')] }]
        };
        const rightInnerA = {
            name: 'right_a',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('right_in')] }],
            outputs: [{ name: 'y', value: [tensor('right_mid')] }]
        };
        const rightInnerB = {
            name: 'right_b',
            type: { name: 'Relu' },
            inputs: [{ name: 'x', value: [tensor('right_mid')] }],
            outputs: [{ name: 'y', value: [tensor('right_out')] }]
        };
        const leftCompiled = {
            name: 'left_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('left_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('left_out')] }],
            nodes: [leftInner]
        };
        const rightCompiled = {
            name: 'right_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('right_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('right_out')] }],
            nodes: [rightInnerA, rightInnerB]
        };
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'main',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('main_out')] }]
                },
                {
                    name: 'frag_left',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: leftCompiled }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'frag_right',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: rightCompiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(new Map([
                [graph.nodes[0], { x: 0, y: 0 }],
                [graph.nodes[1], { x: 1, y: 0 }],
                [graph.nodes[2], { x: 1, y: 10 }]
            ])),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[0]._bftNumber, 1);
        assert.equal(leftInner._bftNumber, 2);
        assert.equal(rightInnerA._bftNumber, 3);
        assert.equal(rightInnerB._bftNumber, 4);
        assert.equal(graph.nodes[1]._bftNumber, undefined);
        assert.equal(graph.nodes[2]._bftNumber, undefined);
    });

    it('numbers userdef compiled graph like frags left to right with global counter', () => {
        const fragLeftInner = {
            name: 'frag_left_inner',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('left_in')] }],
            outputs: [{ name: 'y', value: [tensor('left_out')] }]
        };
        const fragRightInner = {
            name: 'frag_right_inner',
            type: { name: 'Relu' },
            inputs: [{ name: 'x', value: [tensor('right_in')] }],
            outputs: [{ name: 'y', value: [tensor('right_out')] }]
        };
        const leftCompiled = {
            name: 'left_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('left_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('left_out')] }],
            nodes: [fragLeftInner]
        };
        const rightCompiled = {
            name: 'right_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('right_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('right_out')] }],
            nodes: [fragRightInner]
        };
        const userDefCompiled = {
            name: 'userdef_compiled',
            _ambapbCompiledGraph: true,
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'frag_left',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: leftCompiled }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'frag_right',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: rightCompiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'main',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('main_out')] }]
                },
                {
                    name: 'userdef',
                    type: { name: 'UserDefSubgraph' },
                    attributes: [{ name: 'graph', type: 'graph', value: userDefCompiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(new Map([
                [graph.nodes[0], { x: 0, y: 0 }],
                [graph.nodes[1], { x: 1, y: 0 }],
                [userDefCompiled.nodes[0], { x: 0, y: 0 }],
                [userDefCompiled.nodes[1], { x: 0, y: 10 }]
            ])),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[0]._bftNumber, 1);
        assert.equal(graph.nodes[1]._bftNumber, undefined);
        assert.equal(graph.nodes[1]._bftCheckpoint, undefined);
        assert.equal(fragLeftInner._bftNumber, 2);
        assert.equal(fragRightInner._bftNumber, 3);
    });

    it('numbers flat single-node userdef body like a frag compiled graph', () => {
        const innerConv = {
            name: 'conv0',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('data_in')] }],
            outputs: [{ name: 'y', value: [tensor('data_out')] }]
        };
        const userDefCompiled = {
            name: 'userdefsubgraph_0',
            inputs: [{ name: 'input', value: [tensor('data_in')] }],
            outputs: [{ name: 'output', value: [tensor('data_out')] }],
            nodes: [innerConv]
        };
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'main',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('main_out')] }]
                },
                {
                    name: 'userdef',
                    type: { name: 'UserDefSubgraph' },
                    attributes: [{ name: 'graph', type: 'graph', value: userDefCompiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        assignBftNumbers({
            displayGraph: graph,
            sourceGraph: graph,
            viewGraph: mockViewGraph(new Map([
                [graph.nodes[0], { x: 0, y: 0 }],
                [graph.nodes[1], { x: 1, y: 0 }]
            ])),
            layoutDirection: 'horizontal'
        });
        assert.equal(graph.nodes[0]._bftNumber, 1);
        assert.equal(innerConv._bftNumber, 2);
    });

    it('uses compiled frag numbering when viewing a userdef compiled graph directly', () => {
        const inner = {
            name: 'inner',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('sub_in')] }],
            outputs: [{ name: 'y', value: [tensor('sub_out')] }]
        };
        const compiled = {
            name: 'frag_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('sub_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('sub_out')] }],
            nodes: [inner]
        };
        const userDefCompiled = {
            name: 'userdef_compiled',
            _ambapbCompiledGraph: true,
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: compiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        assignBftNumbers({
            displayGraph: userDefCompiled,
            sourceGraph: userDefCompiled,
            navigationHost: { type: { name: 'UserDefSubgraph' } },
            viewGraph: mockViewGraph(new Map([
                [userDefCompiled.nodes[0], { x: 0, y: 0 }]
            ])),
            layoutDirection: 'horizontal'
        });
        assert.equal(resolveAmbapbNumberingMode({
            displayGraph: userDefCompiled,
            navigationHost: { type: { name: 'UserDefSubgraph' } }
        }), 'compiledFrag');
        assert.equal(inner._bftNumber, 1);
        assert.equal(userDefCompiled.nodes[0]._bftNumber, undefined);
    });

    it('numbers only the navigated compiled graph, not sibling frags on the parent', () => {
        const viewedInner = {
            name: 'viewed_inner',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('viewed_in')] }],
            outputs: [{ name: 'y', value: [tensor('viewed_out')] }]
        };
        const siblingInner = {
            name: 'sibling_inner',
            type: { name: 'Relu' },
            inputs: [{ name: 'x', value: [tensor('sibling_in')] }],
            outputs: [{ name: 'y', value: [tensor('sibling_out')] }]
        };
        const viewedCompiled = {
            name: 'viewed_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('viewed_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('viewed_out')] }],
            nodes: [viewedInner]
        };
        const siblingCompiled = {
            name: 'sibling_compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('sibling_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('sibling_out')] }],
            nodes: [siblingInner]
        };
        const runtime = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'main',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('main_out')] }]
                },
                {
                    name: 'viewed_frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: viewedCompiled }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'sibling_frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: siblingCompiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        assignBftNumbers({
            displayGraph: viewedCompiled,
            sourceGraph: viewedCompiled,
            navigationHost: { type: { name: 'FragSubgraph' } },
            viewGraph: mockViewGraph(new Map([
                [viewedInner, { x: 0, y: 0 }]
            ])),
            layoutDirection: 'horizontal'
        });
        assert.equal(viewedInner._bftNumber, 1);
        assert.equal(siblingInner._bftNumber, undefined);
        assert.equal(runtime.nodes[0]._bftNumber, undefined);
    });

    it('hides canvas labels for collapsed frag inner nodes on the runtime graph', () => {
        const inner = {
            name: 'inner',
            type: { name: 'Conv' },
            inputs: [{ name: 'x', value: [tensor('sub_in')] }],
            outputs: [{ name: 'y', value: [tensor('sub_out')] }]
        };
        const compiled = {
            name: 'compiled',
            _ambapbCompiledGraph: true,
            inputs: [{ name: 'sub_input', value: [tensor('sub_in')] }],
            outputs: [{ name: 'sub_output', value: [tensor('sub_out')] }],
            nodes: [inner]
        };
        const runtime = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'main',
                    type: { name: 'Conv' },
                    inputs: [],
                    outputs: [{ name: 'y', value: [tensor('main_out')] }]
                },
                {
                    name: 'frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{ name: 'compiled_prim_graph', type: 'graph', value: compiled }],
                    inputs: [],
                    outputs: []
                }
            ]
        };
        assignBftNumbers({
            displayGraph: runtime,
            sourceGraph: runtime,
            viewGraph: mockViewGraph(new Map()),
            layoutDirection: 'horizontal'
        });
        assert.equal(nodeIsInDisplayedGraph(runtime.nodes[0], runtime), true);
        assert.equal(nodeIsInDisplayedGraph(inner, runtime), false);
        assert.equal(inner._bftNumber, 2);
    });
    it('formats tensor labels with producer/consumer sourceNodeId', () => {
        const graph = buildLinearGraph();
        ensureBftNumbersForDisplayGraph(graph, 'horizontal');
        const inputNode = resolveTensorSourceNode(graph, 'graph_in', 'input');
        const outputNode = resolveTensorSourceNode(graph, 'graph_out', 'output');
        assert.equal(inputNode.name, 'a');
        assert.equal(outputNode.name, 'c');
        assert.equal(formatTensorWithSourceNodeId('graph_in', graph, 'input'), 'graph_in | sourceNodeId: 1');
        assert.equal(formatTensorWithSourceNodeId('graph_out', graph, 'output'), 'graph_out | sourceNodeId: 3');
    });
});
