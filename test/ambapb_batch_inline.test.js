/* 
 * This file tests the batch inline expansion logic
 * Specifics include rewiring logic, which graphs can be inline-expanded (hardcoded to be batch call for now)
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { locateNodeEntity } from '../source/model-editor.js';
import {
    applyBatchInlineExpansions,
    buildNestedCompiledNodeEntityId,
    canExpandBatchCall,
    inlineExpansionBatchCallName,
    materializeUserDefCallExpansion,
    parseMappingAttribute,
    resolveBatchCallTarget,
    sourceEntityIdForNode,
    sourceNodeForEntity
} from '../source/ambapb-batch-inline.js';

const tensor = (name) => ({ name, type: 'float32' });
// build mock producer (input for batch call), batch call, and frag subgraph
const buildRuntimeGraph = () => ({
    name: 'runtime',
    inputs: [],
    outputs: [],
    nodes: [
        {
            name: 'producer',
            type: { name: 'CVFlowNVP' },
            attributes: [],
            inputs: [],
            outputs: [{ name: 'output', value: [tensor('producer_out')] }]
        },
        {
            name: 'frag',
            type: { name: 'FragSubgraph' },
            attributes: [{
                name: 'compiled_prim_graph',
                type: 'graph',
                value: {
                    name: 'subgraph_body',
                    inputs: [
                        { name: 'sub_input_0', value: [tensor('sub_input_0')] },
                        { name: 'sub_input_1', value: [tensor('sub_input_1')] }
                    ],
                    outputs: [
                        { name: 'sub_output_0', value: [tensor('sub_output_0')] }
                    ],
                    nodes: [
                        {
                            name: 'inner_nvp',
                            type: { name: 'CVFlowNVP' },
                            attributes: [],
                            inputs: [
                                { name: 'input0', value: [tensor('sub_input_0')] },
                                { name: 'input1', value: [tensor('sub_input_1')] }
                            ],
                            outputs: [{ name: 'output', value: [tensor('sub_output_0')] }]
                        }
                    ]
                }
            }],
            inputs: [],
            outputs: []
        },
        {
            name: 'batch_call',
            type: { name: 'BatchCall' },
            attributes: [
                { name: 'batch_size', type: 'int64', value: 8 },
                { name: 'graph_id', type: 'string', value: 'subgraph_body' },
                {
                    name: 'src_mappings',
                    type: 'string',
                    value: JSON.stringify([
                        { id: 'sub_input_0' },
                        { id: 'sub_input_1' }
                    ])
                },
                {
                    name: 'out_mappings',
                    type: 'string',
                    value: JSON.stringify([
                        { id: 'sub_output_0' }
                    ])
                }
            ],
            inputs: [
                { name: 'input0', value: [tensor('producer_out')] },
                { name: 'input1', value: [tensor('external_ref')] }
            ],
            outputs: [{ name: 'output', value: [tensor('batch_out')] }]
        },
        {
            name: 'consumer',
            type: { name: 'CVFlowNVP' },
            attributes: [],
            inputs: [{ name: 'input', value: [tensor('batch_out')] }],
            outputs: [{ name: 'output', value: [tensor('consumer_out')] }]
        }
    ]
});

describe('ambapb batch inline expansion', () => {
    // makes sure that we can parse the mapping attributes from JSON strings
    it('parses mapping attributes from JSON strings', () => {
        const parsed = parseMappingAttribute({
            value: JSON.stringify([{ id: 'sub_input_0' }, { id: 'sub_input_1' }])
        });
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0].id, 'sub_input_0');
    });
    // Makes sure that we get the subgraph as the target 
    // since mock subgraph just has one node, we check that we have the right subgraph
    it('resolves BatchCall target through FragSubgraph compiled graph', () => {
        const graph = buildRuntimeGraph();
        const batchCall = graph.nodes.find((node) => node.name === 'batch_call');
        const target = resolveBatchCallTarget(graph, batchCall);
        assert.ok(target);
        assert.equal(target.graphId, 'subgraph_body');
        assert.equal(target.subGraph.nodes.length, 1);
        assert.equal(target.fragSubgraphNode.name, 'frag');
    });
    // For now, we just find whatever node is named batch call
    // in the future, we might have to change from this hardcoded logic
    it('detects expandable BatchCall nodes', () => {
        const graph = buildRuntimeGraph();
        const batchCall = graph.nodes.find((node) => node.name === 'batch_call');
        assert.equal(canExpandBatchCall(graph, batchCall), true);
        assert.equal(canExpandBatchCall(graph, graph.nodes[0]), false);
    });

    it('finds compiled_prim_graph on node blocks', () => {
        const graph = buildRuntimeGraph();
        const frag = graph.nodes.find((node) => node.name === 'frag');
        const compiled = frag.attributes.find((entry) => entry.name === 'compiled_prim_graph');
        frag.blocks = [compiled];
        frag.attributes = [];
        const batchCall = graph.nodes.find((node) => node.name === 'batch_call');
        assert.ok(resolveBatchCallTarget(graph, batchCall));
    });

    it('extracts batch call name from inlined node prefix', () => {
        assert.equal(inlineExpansionBatchCallName({ name: 'inline::batch_call::inner_nvp' }), 'batch_call');
        assert.equal(inlineExpansionBatchCallName({ name: 'inner_nvp' }), null);
    });
    // Make sure that we don't have batch call anymore after inline expansion
    // We prefix node names to avoid confusion
    it('inlines subgraph nodes and removes BatchCall from the display graph', () => {
        const graph = buildRuntimeGraph();
        const expanded = applyBatchInlineExpansions(graph, new Set(['batch_call']));
        const nodeNames = expanded.nodes.map((node) => node.name);
        assert.ok(!nodeNames.includes('batch_call'));
        assert.ok(nodeNames.some((name) => name.startsWith('inline::batch_call::')));
        assert.ok(expanded.nodes.some((node) => node._inlineExpanded));
        assert.equal(expanded._inlineExpandedNodeNames.length, 1);
    });
    // Make sure that our mappings are wired correctly
    it('rewires external inputs and outputs through mappings', () => {
        const graph = buildRuntimeGraph();
        const expanded = applyBatchInlineExpansions(graph, new Set(['batch_call']));
        const inner = expanded.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');
        assert.ok(inner);
        assert.equal(inner.inputs[0].value[0].name, 'producer_out');
        assert.equal(inner.inputs[1].value[0].name, 'external_ref');

        const consumer = expanded.nodes.find((node) => node.name === 'consumer');
        assert.equal(consumer.inputs[0].value[0].name, 'inline::batch_call::sub_output_0');
    });

    // Make sure that we leave the source graph unchanged when no expansions are active
    it('leaves the source graph unchanged when no expansions are active', () => {
        const graph = buildRuntimeGraph();
        const display = applyBatchInlineExpansions(graph, new Set());
        assert.equal(display, graph);
        assert.equal(display.nodes.some((node) => node.name === 'batch_call'), true);
    });
    // Make sure that we restore BatchCall after collapse
    it('restores BatchCall after collapse', () => {
        const graph = buildRuntimeGraph();
        const expanded = applyBatchInlineExpansions(graph, new Set(['batch_call']));
        const collapsed = applyBatchInlineExpansions(graph, new Set());
        assert.equal(collapsed.nodes.some((node) => node.name === 'batch_call'), true);
        assert.equal(expanded.nodes.some((node) => node.name === 'batch_call'), false);
    });
    it('resolves BatchCall target through FragSubgraph graph attribute', () => {
        const subgraphName = 'subgraph_/multi_scale_deform_attention/GridSample_output_0_frag';
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'frag_with_graph_attr',
                    type: { name: 'FragSubgraph' },
                    attributes: [{
                        name: 'graph',
                        type: 'graph',
                        value: {
                            name: subgraphName,
                            inputs: [{ name: 'sub_input_0', value: [tensor('sub_input_0')] }],
                            outputs: [{ name: 'sub_output_0', value: [tensor('sub_output_0')] }],
                            nodes: [{
                                name: 'inner_nvp',
                                type: { name: 'CVFlowNVP' },
                                attributes: [],
                                inputs: [{ name: 'input0', value: [tensor('sub_input_0')] }],
                                outputs: [{ name: 'output', value: [tensor('sub_output_0')] }]
                            }]
                        }
                    }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'batch_call',
                    type: { name: 'BatchCall' },
                    attributes: [
                        { name: 'graph_id', type: 'string', value: subgraphName },
                        {
                            name: 'src_mappings',
                            type: 'string',
                            value: JSON.stringify([{ id: 'sub_input_0' }])
                        },
                        {
                            name: 'out_mappings',
                            type: 'string',
                            value: JSON.stringify([{ id: 'sub_output_0' }])
                        }
                    ],
                    inputs: [{ name: 'input0', value: [tensor('producer_out')] }],
                    outputs: [{ name: 'output', value: [tensor('batch_out')] }]
                }
            ]
        };
        const batchCall = graph.nodes.find((node) => node.name === 'batch_call');
        const target = resolveBatchCallTarget(graph, batchCall);
        assert.ok(target);
        assert.equal(target.graphId, subgraphName);
        assert.equal(target.fragSubgraphNode.name, 'frag_with_graph_attr');
        assert.equal(target.subGraph.name, subgraphName);
        assert.equal(canExpandBatchCall(graph, batchCall), true);
    });
    it('links display nodes back to source model nodes', () => {
        const graph = buildRuntimeGraph();
        const expanded = applyBatchInlineExpansions(graph, new Set(['batch_call']));

        const producer = expanded.nodes.find((node) => node.name === 'producer');
        const consumer = expanded.nodes.find((node) => node.name === 'consumer');
        const inner = expanded.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');
        const sourceInner = graph.nodes
            .find((node) => node.name === 'frag')
            .attributes.find((entry) => entry.name === 'compiled_prim_graph')
            .value.nodes.find((node) => node.name === 'inner_nvp');

        assert.equal(producer._sourceNode, graph.nodes.find((node) => node.name === 'producer'));
        assert.equal(consumer._sourceNode, graph.nodes.find((node) => node.name === 'consumer'));
        assert.equal(inner._sourceNode, sourceInner);
        assert.ok(inner._sourceEntityId.includes('/compiled_prim_graph/node:'));
    });

    it('resolves entity source for unchanged and inlined nodes', () => {
        const graph = buildRuntimeGraph();
        const expanded = applyBatchInlineExpansions(graph, new Set(['batch_call']));

        const producer = expanded.nodes.find((node) => node.name === 'producer');
        const inner = expanded.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');
        const sourceInner = graph.nodes
            .find((node) => node.name === 'frag')
            .attributes.find((entry) => entry.name === 'compiled_prim_graph')
            .value.nodes.find((node) => node.name === 'inner_nvp');

        assert.equal(
            sourceNodeForEntity(producer),
            graph.nodes.find((node) => node.name === 'producer')
        );
        assert.equal(sourceNodeForEntity(inner), sourceInner);
        assert.equal(sourceEntityIdForNode(inner), inner._sourceEntityId);
        assert.equal(sourceNodeForEntity(graph.nodes[0]), graph.nodes[0]);
    });

    it('builds nested entity ids for inlined compiled nodes', () => {
        assert.equal(
            buildNestedCompiledNodeEntityId(0, 1, 'compiled_prim_graph', 0),
            'graph:0/node:1/compiled_prim_graph/node:0'
        );
    });

    it('locates nested compiled graph nodes in the model', () => {
        const graph = buildRuntimeGraph();
        const model = { modules: [graph] };
        const inner = graph.nodes
            .find((node) => node.name === 'frag')
            .attributes.find((entry) => entry.name === 'compiled_prim_graph')
            .value.nodes.find((node) => node.name === 'inner_nvp');
        const entity = locateNodeEntity(model, inner);
        assert.ok(entity);
        assert.equal(entity.nodeId, 'graph:0/node:1/compiled_prim_graph/node:0');
    });
    // Make sure we get description from source model in cloneNode
    it('preserves description on inlined nodes', () => {
        const graph = buildRuntimeGraph();
        const sourceInner = graph.nodes
            .find((node) => node.name === 'frag')
            .attributes.find((entry) => entry.name === 'compiled_prim_graph')
            .value.nodes.find((node) => node.name === 'inner_nvp');
        sourceInner.description = '{"coproc":{"payload-id":"test"}}';

        const expanded = applyBatchInlineExpansions(graph, new Set(['batch_call']));
        const inner = expanded.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');

        assert.equal(inner.description, sourceInner.description);
    });

    it('materializes UserDefCall expansion into the source graph', () => {
        const subgraphName = 'userdefsubgraph_0';
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: subgraphName,
                    type: { name: 'UserDefSubgraph' },
                    attributes: [{
                        name: 'graph',
                        type: 'graph',
                        value: {
                            name: subgraphName,
                            inputs: [{ name: 'sub_input_0', value: [tensor('sub_input_0')] }],
                            outputs: [{ name: 'sub_output_0', value: [tensor('sub_output_0')] }],
                            nodes: [{
                                name: 'inner_nvp',
                                type: { name: 'CVFlowNVP' },
                                attributes: [],
                                inputs: [{ name: 'input0', value: [tensor('sub_input_0')] }],
                                outputs: [{ name: 'output', value: [tensor('sub_output_0')] }]
                            }]
                        }
                    }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'user_def_call',
                    type: { name: 'UserDefCall' },
                    attributes: [
                        { name: 'graph_id', type: 'string', value: subgraphName },
                        {
                            name: 'src_mappings',
                            type: 'string',
                            value: JSON.stringify([{ id: 'sub_input_0' }])
                        },
                        {
                            name: 'out_mappings',
                            type: 'string',
                            value: JSON.stringify([{ id: 'sub_output_0' }])
                        }
                    ],
                    inputs: [{ name: 'input0', value: [tensor('producer_out')] }],
                    outputs: [{ name: 'output', value: [tensor('batch_out')] }]
                }
            ]
        };

        const userDefCall = graph.nodes.find((node) => node.name === 'user_def_call');
        const target = resolveBatchCallTarget(graph, userDefCall);
        assert.ok(target);
        assert.equal(target.graphId, subgraphName);
        assert.equal(target.fragSubgraphNode.name, subgraphName);
        assert.equal(target.subGraph.name, subgraphName);
        assert.equal(canExpandBatchCall(graph, userDefCall), true);

        const result = materializeUserDefCallExpansion(graph, 'user_def_call');
        assert.ok(result);
        const nodeNames = result.graph.nodes.map((node) => node.name);
        assert.ok(!nodeNames.includes('user_def_call'));
        assert.ok(!nodeNames.includes(subgraphName));
        assert.ok(nodeNames.includes('inner_nvp'));

        const inner = result.graph.nodes.find((node) => node.name === 'inner_nvp');
        assert.ok(inner);
        assert.equal(inner.inputs[0].value[0].name, 'producer_out');
        assert.equal(inner._inlineExpanded, undefined);
    });

    it('materializes UserDefCall with embedded BatchCall without duplicating FragSubgraph', () => {
        const subgraphName = 'userdefsubgraph_0';
        const graph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'frag',
                    type: { name: 'FragSubgraph' },
                    attributes: [{
                        name: 'compiled_prim_graph',
                        type: 'graph',
                        value: {
                            name: 'subgraph_body',
                            inputs: [{ name: 'sub_input_0', value: [tensor('sub_input_0')] }],
                            outputs: [{ name: 'sub_output_0', value: [tensor('sub_output_0')] }],
                            nodes: [{
                                name: 'inner_nvp',
                                type: { name: 'CVFlowNVP' },
                                attributes: [],
                                inputs: [{ name: 'input0', value: [tensor('sub_input_0')] }],
                                outputs: [{ name: 'output', value: [tensor('sub_output_0')] }]
                            }]
                        }
                    }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: subgraphName,
                    type: { name: 'UserDefSubgraph' },
                    attributes: [{
                        name: 'graph',
                        type: 'graph',
                        value: {
                            name: subgraphName,
                            inputs: [{ name: 'sub_input_0', value: [tensor('sub_input_0')] }],
                            outputs: [{ name: 'sub_output_0', value: [tensor('sub_output_0')] }],
                            nodes: [
                                {
                                    name: 'frag',
                                    type: { name: 'FragSubgraph' },
                                    attributes: [{
                                        name: 'compiled_prim_graph',
                                        type: 'graph',
                                        value: {
                                            name: 'subgraph_body',
                                            inputs: [{ name: 'sub_input_0', value: [tensor('sub_input_0')] }],
                                            outputs: [{ name: 'sub_output_0', value: [tensor('sub_output_0')] }],
                                            nodes: [{
                                                name: 'inner_nvp',
                                                type: { name: 'CVFlowNVP' },
                                                attributes: [],
                                                inputs: [{ name: 'input0', value: [tensor('sub_input_0')] }],
                                                outputs: [{ name: 'output', value: [tensor('sub_output_0')] }]
                                            }]
                                        }
                                    }],
                                    inputs: [],
                                    outputs: []
                                },
                                {
                                    name: 'batch_call',
                                    type: { name: 'BatchCall' },
                                    attributes: [
                                        { name: 'graph_id', type: 'string', value: 'subgraph_body' },
                                        {
                                            name: 'src_mappings',
                                            type: 'string',
                                            value: JSON.stringify([{ id: 'sub_input_0' }])
                                        },
                                        {
                                            name: 'out_mappings',
                                            type: 'string',
                                            value: JSON.stringify([{ id: 'sub_output_0' }])
                                        }
                                    ],
                                    inputs: [{ name: 'input0', value: [tensor('producer_out')] }],
                                    outputs: [{ name: 'output', value: [tensor('batch_out')] }]
                                }
                            ]
                        }
                    }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'user_def_call',
                    type: { name: 'UserDefCall' },
                    attributes: [
                        { name: 'graph_id', type: 'string', value: subgraphName },
                        {
                            name: 'src_mappings',
                            type: 'string',
                            value: JSON.stringify([{ id: 'sub_input_0' }])
                        },
                        {
                            name: 'out_mappings',
                            type: 'string',
                            value: JSON.stringify([{ id: 'sub_output_0' }])
                        }
                    ],
                    inputs: [{ name: 'input0', value: [tensor('producer_out')] }],
                    outputs: [{ name: 'output', value: [tensor('batch_out')] }]
                }
            ]
        };

        const result = materializeUserDefCallExpansion(graph, 'user_def_call');
        assert.ok(result);
        const fragNodes = result.graph.nodes.filter((node) => node.type?.name === 'FragSubgraph');
        assert.equal(fragNodes.length, 1);
        assert.equal(fragNodes[0].name, 'frag');
        assert.ok(result.graph.nodes.some((node) => node.name === 'batch_call'));
        assert.ok(!result.graph.nodes.some((node) => node.type?.name === 'UserDefSubgraph'));
        assert.ok(!result.graph.nodes.some((node) => node.type?.name === 'UserDefCall'));
    });
});

