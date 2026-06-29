/*
 * Tests the subgraph logic for ambapb checkpoint graphs
 * Use a mock graph to test the subgraph extract logic
 * Makes sure the subgraph contains all expected nodes and tensors
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildExtractWorkingGraph,
    resolveMarkedNodesByName,
    stripInlineExpansionName,
    stripInlineExpansionPrefixes
} from '../source/ambapb-subgraph.js';
import { extractSubgraph, ModelEditor, SubgraphExtractError } from '../source/model-editor.js';

const tensor = (name) => ({ name, type: 'float32' });

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

describe('ambapb subgraph extract', () => {
    it('stripInlineExpansionName removes inline prefixes', () => {
        assert.equal(stripInlineExpansionName('inline::batch_call::inner_nvp'), 'inner_nvp');
        assert.equal(stripInlineExpansionName('producer'), 'producer');
    });

    it('resolveMarkedNodesByName finds nodes in the working graph', () => {
        const source = buildRuntimeGraph();
        const working = buildExtractWorkingGraph(source, new Set(['batch_call']));
        const markers = [{ graphIndex: 0, nodeName: 'inline::batch_call::inner_nvp' }];
        const nodes = resolveMarkedNodesByName(working, markers);
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].name, 'inline::batch_call::inner_nvp');
    });

    it('resolveMarkedNodesByName throws when a marked node is missing', () => {
        const source = buildRuntimeGraph();
        const working = buildExtractWorkingGraph(source, new Set());
        assert.throws(
            () => resolveMarkedNodesByName(working, [{ graphIndex: 0, nodeName: 'Missing' }]),
            SubgraphExtractError
        );
    });

    it('stripInlineExpansionPrefixes cleans extracted graph node and tensor names', () => {
        const extracted = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [{
                name: 'inline::batch_call::inner_nvp',
                type: { name: 'CVFlowNVP' },
                attributes: [],
                inputs: [{ name: 'input0', value: [{ name: 'inline::batch_call::sub_input_0' }] }],
                outputs: [{ name: 'output', value: [{ name: 'inline::batch_call::sub_output_0' }] }],
                _inlineExpanded: true
            }]
        };
        const cleaned = stripInlineExpansionPrefixes(extracted);
        assert.equal(cleaned.nodes[0].name, 'inner_nvp');
        assert.equal(cleaned.nodes[0]._inlineExpanded, undefined);
        assert.equal(cleaned.nodes[0].inputs[0].value[0].name, 'sub_input_0');
        assert.equal(cleaned.nodes[0].outputs[0].value[0].name, 'sub_output_0');
    });

    it('extracts a slice from an inline-expanded working graph', () => {
        const source = buildRuntimeGraph();
        const working = buildExtractWorkingGraph(source, new Set(['batch_call']));
        const producer = working.nodes.find((node) => node.name === 'producer');
        const inner = working.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');
        let extracted = extractSubgraph(working, [producer], [inner]);
        extracted = stripInlineExpansionPrefixes(extracted);
        assert.equal(extracted.nodes.length, 2);
        assert.equal(extracted.nodes[0].name, 'producer');
        assert.equal(extracted.nodes[1].name, 'inner_nvp');
        assert.equal(extracted.inputs.length, 0);
        assert.ok(extracted.outputs.length >= 1);
    });

    it('replaceGraph stores extracted runtime subgraph in the editor session', () => {
        const source = buildRuntimeGraph();
        const working = buildExtractWorkingGraph(source, new Set(['batch_call']));
        const producer = working.nodes.find((node) => node.name === 'producer');
        const inner = working.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');
        let extracted = extractSubgraph(working, [producer], [inner]);
        extracted = stripInlineExpansionPrefixes(extracted);

        const model = { format: 'Mock', modules: [source] };
        const editor = ModelEditor.createSession(model);
        editor.replaceGraph(0, extracted);

        const stored = editor.modified.getGraph(0);
        assert.equal(stored.nodes.length, 2);
        assert.equal(stored.nodes[1].name, 'inner_nvp');
        assert.equal(editor.delta.getChanges().length, 0);
    });
});
