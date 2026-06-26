import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockChainModel } from './fixtures/mock-graph.js';
import { extractSubgraph, findValueConsumers, genUniqueNodeName } from '../source/model-editor.js';

// The identical implementation of findBoundaryNodes from view.js
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
            if (isBegin) break;
        }
        if (isBegin) {
            beginNodes.push(node);
        }
        
        let isEnd = false;
        for (const output of node.outputs || []) {
            for (const val of argumentValues(output)) {
                if (!val || !val.name) continue;
                const isGraphOutput = (graph.outputs || []).some(o => 
                    argumentValues(o).some(v => v && v.name === val.name)
                );
                if (isGraphOutput) {
                    isEnd = true;
                    break;
                }
                const consumers = findValueConsumers(graph, val);
                const hasExternalConsumer = consumers.some(c => c.node && !selectedNodesSet.has(c.node));
                if (hasExternalConsumer) {
                    isEnd = true;
                    break;
                }
            }
            if (isEnd) break;
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

describe('UserDefCall and boundary selection', () => {
    it('correctly identifies boundary nodes for a single middle node', () => {
        const graph = mockChainModel.modules[0];
        // Relu1 is index 1
        const relu = graph.nodes[1];
        const { beginNodes, endNodes } = findBoundaryNodes(graph, [relu]);
        
        assert.equal(beginNodes.length, 1);
        assert.equal(beginNodes[0].name, 'Relu1');
        assert.equal(endNodes.length, 1);
        assert.equal(endNodes[0].name, 'Relu1');
    });

    it('correctly identifies boundary nodes for a prefix slice (nodes 0 and 1)', () => {
        const graph = mockChainModel.modules[0];
        const selected = [graph.nodes[0], graph.nodes[1]]; // Conv1 and Relu1
        const { beginNodes, endNodes } = findBoundaryNodes(graph, selected);
        
        assert.equal(beginNodes.length, 1);
        assert.equal(beginNodes[0].name, 'Conv1');
        assert.equal(endNodes.length, 1);
        assert.equal(endNodes[0].name, 'Relu1');
    });

    it('correctly extracts subgraph and constructs UserDefSubgraph + UserDefCall', () => {
        const graph = mockChainModel.modules[0];
        const selectedNodes = [graph.nodes[0], graph.nodes[1]]; // Conv1 and Relu1
        
        const { beginNodes, endNodes } = findBoundaryNodes(graph, selectedNodes);
        const extracted = extractSubgraph(graph, beginNodes, endNodes);
        
        assert.equal(extracted.nodes.length, 2);
        assert.equal(extracted.inputs.length, 1);
        assert.equal(extracted.inputs[0].value[0].name, 'input');
        assert.equal(extracted.outputs.length, 1);
        assert.equal(extracted.outputs[0].value[0].name, 'hidden2');
        
        // Mock the UserDefSubgraph creation
        const subGraphId = genUniqueNodeName('userdefsubgraph', graph);
        const callNodeName = genUniqueNodeName('userDefCall', graph);
        
        const userDefSubgraphNode = {
            name: subGraphId,
            type: {
                name: 'UserDefSubgraph',
                identifier: 'UserDefSubgraph',
                module: 'com.ambarella'
            },
            attributes: [
                {
                    name: 'graph',
                    type: 'graph',
                    value: extracted
                }
            ],
            inputs: [],
            outputs: []
        };
        
        // Mock mappings creation
        const src_mappings = [];
        const userDefCallInputs = [];
        for (let i = 0; i < extracted.inputs.length; i++) {
            const input = extracted.inputs[i];
            const valName = input.value && input.value[0] ? input.value[0].name : '';
            src_mappings.push({
                id: valName,
                index: i
            });
            userDefCallInputs.push({
                name: input.name,
                value: input.value.map(val => Object.assign({}, val))
            });
        }
        
        const out_mappings = [];
        const userDefCallOutputs = [];
        for (let i = 0; i < extracted.outputs.length; i++) {
            const output = extracted.outputs[i];
            const valName = output.value && output.value[0] ? output.value[0].name : '';
            out_mappings.push({
                id: valName,
                index: i
            });
            userDefCallOutputs.push({
                name: output.name,
                value: output.value.map(val => Object.assign({}, val))
            });
        }
        
        const userDefCallNode = {
            name: callNodeName,
            type: {
                name: 'UserDefCall',
                identifier: 'UserDefCall',
                module: 'com.ambarella'
            },
            attributes: [
                {
                    name: 'graph_id',
                    type: 'string',
                    value: subGraphId
                },
                {
                    name: 'src_mappings',
                    type: 'string',
                    value: JSON.stringify(src_mappings)
                },
                {
                    name: 'out_mappings',
                    type: 'string',
                    value: JSON.stringify(out_mappings)
                }
            ],
            inputs: userDefCallInputs,
            outputs: userDefCallOutputs
        };
        
        assert.equal(userDefCallNode.type.name, 'UserDefCall');
        assert.equal(userDefCallNode.attributes[0].value, 'userdefsubgraph');
        assert.equal(userDefCallNode.attributes[1].value, JSON.stringify([{ id: 'input', index: 0 }]));
        assert.equal(userDefCallNode.attributes[2].value, JSON.stringify([{ id: 'hidden2', index: 0 }]));
        
        // Mock replacement: remove Conv1 and Relu1, insert UserDefCall at Relu1's position
        let rootNodeIndex = -1;
        for (const node of selectedNodes) {
            const idx = graph.nodes.indexOf(node);
            if (idx > rootNodeIndex) {
                rootNodeIndex = idx;
            }
        }
        assert.equal(rootNodeIndex, 1); // Relu1 is at index 1
        
        const keepSet = new Set(selectedNodes);
        const nextNodes = [];
        for (let i = 0; i < graph.nodes.length; i++) {
            const node = graph.nodes[i];
            if (keepSet.has(node)) {
                if (i === rootNodeIndex) {
                    nextNodes.push(userDefCallNode);
                }
            } else {
                nextNodes.push(node);
            }
        }
        let insertIdx = 0;
        for (let i = 0; i < nextNodes.length; i++) {
            const node = nextNodes[i];
            if (node && node.type && (node.type.name === 'FragSubgraph' || node.type.name === 'UserDefSubgraph')) {
                insertIdx = i + 1;
            }
        }
        nextNodes.splice(insertIdx, 0, userDefSubgraphNode);
        
        // Original nodes count was 3. We removed 2 selected nodes, inserted 1 UserDefCall, and prepended 1 UserDefSubgraph.
        // So nodes count should now be: 3 - 2 + 1 + 1 = 3 nodes!
        assert.equal(nextNodes.length, 3);
        assert.equal(nextNodes[0].name, 'userdefsubgraph');
        assert.equal(nextNodes[0].type.name, 'UserDefSubgraph');
        assert.equal(nextNodes[1].name, 'userDefCall');
        assert.equal(nextNodes[1].type.name, 'UserDefCall');
        assert.equal(nextNodes[2].name, 'Softmax1');
    });
});
