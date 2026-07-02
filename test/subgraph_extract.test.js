import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockChainModel } from './fixtures/mock-graph.js';
import {
    ModelEditor,
    collectNodesBetween,
    extractSubgraph,
    findValueConsumers,
    promoteVisibleGraphOutputs,
    SubgraphExtractError
} from '../source/model-editor.js';
import { promoteNestedGraphOutputs } from '../source/ambapb-subgraph.js';

const tensor = (name) => ({ name, type: 'float32' });

const buildAmbaShellGraph = () => ({
    name: 'runtime',
    inputs: [],
    outputs: [{ name: 'output', value: [tensor('output')] }],
    nodes: [
        {
            name: 'conti_1320_prim_nvp0',
            type: { name: 'CVFlowNVP' },
            attributes: [],
            inputs: [],
            outputs: [
                { name: 'out0', value: [tensor('conti_1320_prim_nvp0:0')] },
                { name: 'out1', value: [tensor('conti_1320_prim_nvp0:1')] },
                { name: 'out2', value: [tensor('conti_1320_prim_nvp0:2')] },
                { name: 'out3', value: [tensor('conti_1320_prim_nvp0:3')] }
            ]
        },
        {
            name: 'conti_1320_prim_runtime2',
            type: { name: 'BatchCall' },
            attributes: [],
            inputs: [
                { name: 'in0', value: [tensor('conti_1320_prim_nvp0:0')] },
                { name: 'in1', value: [tensor('conti_1320_prim_nvp0:2')] }
            ],
            outputs: [{ name: 'out0', value: [tensor('conti_1320_prim_runtime2:0')] }]
        },
        {
            name: 'conti_1320_prim_nvp1',
            type: { name: 'CVFlowNVP' },
            attributes: [],
            inputs: [
                { name: 'in0', value: [tensor('conti_1320_prim_runtime2:0')] },
                { name: 'in1', value: [tensor('conti_1320_prim_nvp0:3')] },
                { name: 'in2', value: [tensor('conti_1320_prim_nvp0:1')] }
            ],
            outputs: [{ name: 'output', value: [tensor('output')] }]
        }
    ]
});

// Same logic as view.js findBoundaryNodes (UserDefCall selection path).
const findBoundaryNodes = (graph, selectedNodes) => {
    const selectedNodesSet = new Set(selectedNodes);
    const beginNodes = [];
    const endNodes = [];

    const argumentValues = (argument) => {
        if (!argument || argument.value === null || argument.value === undefined) {
            return [];
        }
        return Array.isArray(argument.value) ? argument.value : [argument.value];
    };

    const internalValues = new Set();
    for (const node of selectedNodes) {
        for (const output of node.outputs || []) {
            for (const val of argumentValues(output)) {
                if (val && val.name) {
                    internalValues.add(val.name);
                }
            }
        }
    }

    for (const node of selectedNodes) {
        let isBegin = false;
        for (const input of node.inputs || []) {
            for (const val of argumentValues(input)) {
                if (val && val.name && !val.initializer && !internalValues.has(val.name)) {
                    isBegin = true;
                    break;
                }
            }
            if (isBegin) {
                break;
            }
        }
        if (isBegin) {
            beginNodes.push(node);
        }

        let isEnd = false;
        for (const output of node.outputs || []) {
            for (const val of argumentValues(output)) {
                if (!val || !val.name) {
                    continue;
                }
                const isGraphOutput = (graph.outputs || []).some((o) =>
                    argumentValues(o).some((v) => v && v.name === val.name)
                );
                if (isGraphOutput) {
                    isEnd = true;
                    break;
                }
                const consumers = findValueConsumers(graph, val);
                const hasExternalConsumer = consumers.some((c) => c.node && !selectedNodesSet.has(c.node));
                if (hasExternalConsumer) {
                    isEnd = true;
                    break;
                }
            }
            if (isEnd) {
                break;
            }
        }
        if (isEnd) {
            endNodes.push(node);
        }
    }

    if (beginNodes.length === 0 && selectedNodes.length > 0) {
        beginNodes.push(...selectedNodes);
    }
    if (endNodes.length === 0 && selectedNodes.length > 0) {
        endNodes.push(...selectedNodes);
    }
    return { beginNodes, endNodes };
};

describe('subgraph extract', () => {
    it('collects all nodes on a linear chain from begin to end', () => {
        const graph = mockChainModel.modules[0];
        const begin = graph.nodes[0];
        const end = graph.nodes[2];
        const nodes = collectNodesBetween(graph, begin, end);
        assert.equal(nodes.size, 3);
        assert.ok(nodes.has(begin));
        assert.ok(nodes.has(graph.nodes[1]));
        assert.ok(nodes.has(end));
    });

    it('collects a partial chain slice', () => {
        const graph = mockChainModel.modules[0];
        const begin = graph.nodes[0];
        const end = graph.nodes[1];
        const nodes = collectNodesBetween(graph, begin, end);
        assert.equal(nodes.size, 2);
        assert.ok(nodes.has(begin));
        assert.ok(nodes.has(end));
    });

    it('rejects unreachable end node', () => {
        const graph = mockChainModel.modules[0];
        const begin = graph.nodes[2];
        const end = graph.nodes[0];
        assert.throws(
            () => collectNodesBetween(graph, begin, end),
            SubgraphExtractError
        );
    });

    it('extractSubgraph builds boundary inputs and outputs', () => {
        const graph = mockChainModel.modules[0];
        const extracted = extractSubgraph(graph, graph.nodes[0], graph.nodes[1]);
        assert.equal(extracted.nodes.length, 2);
        assert.equal(extracted.nodes[0].name, 'Conv1');
        assert.equal(extracted.nodes[1].name, 'Relu1');
        assert.equal(extracted.inputs.length, 1);
        assert.equal(extracted.inputs[0].value[0].name, 'input');
        assert.equal(extracted.outputs.length, 1);
        assert.equal(extracted.outputs[0].value[0].name, 'hidden2');
    });

    it('replaceGraph resets delta tracker', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.test',
            newValue: 1
        });
        assert.equal(editor.delta.getChanges().length, 1);
        const graph = editor.modified.getGraph();
        const extracted = extractSubgraph(graph, graph.nodes[0], graph.nodes[2]);
        editor.replaceGraph(0, extracted);
        assert.equal(editor.delta.getChanges().length, 0);
        assert.equal(editor.modified.getGraph().nodes.length, 3);
    });

    it('extractSubgraph promotes CVFlowNVP and BatchCall cut outputs for display', () => {
        const graph = buildAmbaShellGraph();
        const nvp0 = graph.nodes[0];
        const batch = graph.nodes[1];
        const extracted = extractSubgraph(graph, [nvp0], [batch]);
        const names = extracted.outputs.map((entry) => entry.value[0].name).sort();
        assert.deepEqual(names, [
            'conti_1320_prim_nvp0:1',
            'conti_1320_prim_nvp0:3',
            'conti_1320_prim_runtime2:0'
        ]);
    });

    it('extractSubgraph via findBoundaryNodes omits BatchCall input tensors from outputs', () => {
        const graph = buildAmbaShellGraph();
        const nvp0 = graph.nodes[0];
        const batch = graph.nodes[1];
        const selected = [nvp0, batch];
        const { beginNodes, endNodes } = findBoundaryNodes(graph, selected);

        // Mock nvp0 has no graph inputs; findBoundaryNodes falls back to all selected nodes as begins.
        assert.deepEqual(beginNodes.map((node) => node.name).sort(), [
            'conti_1320_prim_nvp0',
            'conti_1320_prim_runtime2'
        ]);
        assert.deepEqual(endNodes.map((node) => node.name).sort(), [
            'conti_1320_prim_nvp0',
            'conti_1320_prim_runtime2'
        ]);

        const extracted = extractSubgraph(graph, beginNodes, endNodes);
        const names = extracted.outputs.map((entry) => entry.value[0].name).sort();
        assert.deepEqual(names, [
            'conti_1320_prim_nvp0:1',
            'conti_1320_prim_nvp0:3',
            'conti_1320_prim_runtime2:0'
        ]);
    });

    it('promoteVisibleGraphOutputs adds terminals for orphan node outputs', () => {
        const graph = {
            name: 'g',
            inputs: [],
            outputs: [],
            nodes: [{
                name: 'nvp0',
                type: { name: 'CVFlowNVP' },
                inputs: [],
                outputs: [
                    { name: 'out1', value: [tensor('conti_1320_prim_nvp0:1')] },
                    { name: 'out3', value: [tensor('conti_1320_prim_nvp0:3')] }
                ]
            }]
        };
        promoteVisibleGraphOutputs(graph);
        assert.equal(graph.outputs.length, 2);
        assert.ok(graph.outputs.some((entry) => entry.value[0].name === 'conti_1320_prim_nvp0:3'));
    });

    it('promoteNestedGraphOutputs promotes cut outputs inside nested graph attributes', () => {
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [{
                name: 'frag',
                type: { name: 'FragSubgraph' },
                attributes: [{
                    name: 'graph',
                    type: 'graph',
                    value: {
                        name: 'inner',
                        inputs: [],
                        outputs: [],
                        nodes: [{
                            name: 'inner_nvp',
                            type: { name: 'CVFlowNVP' },
                            inputs: [],
                            outputs: [
                                { name: 'out0', value: [tensor('sub_out_a')] },
                                { name: 'out1', value: [tensor('sub_out_b')] }
                            ]
                        }]
                    }
                }],
                inputs: [],
                outputs: []
            }]
        };
        promoteNestedGraphOutputs(graph);
        const inner = graph.nodes[0].attributes[0].value;
        assert.equal(inner.outputs.length, 2);
        assert.ok(inner.outputs.some((entry) => entry.value[0].name === 'sub_out_b'));
    });
});
