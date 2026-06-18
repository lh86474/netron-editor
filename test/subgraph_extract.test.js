/* 
 * This file has tests for the subgraph extract feature
 * Tests full chain slice (basically whole graph)
 * Proper subgraph extraction
 * Unreachable end throws SubgraphExtractError
 * replaceGraph: swapping the graph resets the delta tracker
 * Author: Luray He
 */ 
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockChainModel } from './fixtures/mock-graph.js';
import {
    ModelEditor,
    collectNodesBetween,
    extractSubgraph,
    SubgraphExtractError
} from '../source/model-editor.js';

describe('subgraph extract', () => {
    // mockChainModel has three nodes: Conv1, Relu1, and Softmax1
    // we use helper method collectNodesBetween from the beginning and end and makes sure that the graph has all three nodes
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
    // The first two nodes. We get those
    it('collects a partial chain slice', () => {
        const graph = mockChainModel.modules[0];
        const begin = graph.nodes[0];
        const end = graph.nodes[1];
        const nodes = collectNodesBetween(graph, begin, end);
        assert.equal(nodes.size, 2);
        assert.ok(nodes.has(begin));
        assert.ok(nodes.has(end));
    });
    // end is set as the beginning node, which is an issue because the end node should be deeper than 
    // the start node. Checks if we throw a SubgraphExtractError
    it('rejects unreachable end node', () => {
        const graph = mockChainModel.modules[0];
        const begin = graph.nodes[2];
        const end = graph.nodes[0];
        assert.throws(
            () => collectNodesBetween(graph, begin, end),
            SubgraphExtractError
        );
    });
    // Makes sure that the input and outupt has its proper name rather than just x and y
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
    // Has to replace the delta tracker or else export and undo-redo will all go wrong
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
});
