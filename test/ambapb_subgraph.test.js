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
    stripInlineExpansionPrefixes,
    resolveExtractGraphContext,
    applyExtractedGraph,
    appendReferencedSubgraphDefinitions
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

    it('resolveExtractGraphContext finds nested compiled graphs from markers', () => {
        const source = buildRuntimeGraph();
        const marker = {
            graphIndex: 0,
            nodeName: 'inner_nvp',
            nodeId: 'graph:0/node:1/compiled_prim_graph/node:0'
        };
        const context = resolveExtractGraphContext(source, marker);
        assert.ok(context.extractGraph);
        assert.equal(context.extractGraph.nodes[0].name, 'inner_nvp');
        assert.deepEqual(context.replaceTarget, { hostNodeIndex: 1, attrName: 'compiled_prim_graph' });
    });

    it('applyExtractedGraph writes nested compiled graph slices back to the host node', () => {
        const source = buildRuntimeGraph();
        const extracted = {
            name: 'subgraph_body',
            inputs: [],
            outputs: [],
            nodes: [{
                name: 'inner_nvp',
                type: { name: 'CVFlowNVP' },
                attributes: [],
                inputs: [],
                outputs: [{ name: 'output', value: [{ name: 'sub_output_0' }] }]
            }]
        };
        const updated = applyExtractedGraph(source, { hostNodeIndex: 1, attrName: 'compiled_prim_graph' }, extracted);
        const compiled = updated.nodes[1].attributes[0].value;
        assert.equal(compiled.nodes.length, 1);
        assert.equal(compiled.nodes[0].name, 'inner_nvp');
    });

    it('appendReferencedSubgraphDefinitions clones FragSubgraph definitions into extracted bodies', () => {
        const source = buildRuntimeGraph();
        const extracted = {
            name: 'slice',
            inputs: [],
            outputs: [],
            nodes: [source.nodes.find((node) => node.name === 'batch_call')]
        };
        const result = appendReferencedSubgraphDefinitions(extracted, source, source);
        assert.equal(result.nodes.length, 2);
        assert.ok(result.nodes.some((node) => node.name === 'frag'));
    });

    it('stripInlineExpansionPrefixes is idempotent', () => {
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
        const once = stripInlineExpansionPrefixes(extracted);
        const twice = stripInlineExpansionPrefixes(once);
        assert.deepEqual(twice, once);
        assert.equal(twice.nodes[0].name, 'inner_nvp');
        assert.equal(twice.nodes[0].inputs[0].value[0].name, 'sub_input_0');
    });

    it('stripInlineExpansionName preserves names that only contain inline:: as a substring', () => {
        assert.equal(stripInlineExpansionName('tensor_inline::suffix'), 'tensor_inline::suffix');
        assert.equal(stripInlineExpansionName('prefix::inline::batch_call::inner'), 'prefix::inline::batch_call::inner');
    });

    it('re-extract from a stripped graph does not accumulate inline prefixes', () => {
        const source = buildRuntimeGraph();
        const working = buildExtractWorkingGraph(source, new Set(['batch_call']));
        const producer = working.nodes.find((node) => node.name === 'producer');
        const inner = working.nodes.find((node) => node.name === 'inline::batch_call::inner_nvp');
        let extracted = extractSubgraph(working, [producer], [inner]);
        extracted = stripInlineExpansionPrefixes(extracted);

        const model = { format: 'Mock', modules: [extracted] };
        const editor = ModelEditor.createSession(model);
        const reworking = buildExtractWorkingGraph(editor.modified.getGraph(0), new Set());
        const renamedInner = reworking.nodes.find((node) => node.name === 'inner_nvp');
        assert.ok(renamedInner);
        assert.ok(!reworking.nodes.some((node) => node.name.includes('inline::')));
    });
});
