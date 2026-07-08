/*
 * Assert that when we attach a checkpoint, we can edit the prim_graph JSON text
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachCheckpoint, canEditCheckpoint, canExportCheckpoint } from '../source/ambapb.js';
import { parsePrimGraphJson } from '../source/ambapb-prim-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

const buildCheckpointProto = (primGraphRaw) => ({
    graph: {
        node: [{
            op_type: 'CVFlowNVP',
            attribute: [{
                name: 'prim_graph',
                t: { raw_data: new TextEncoder().encode(JSON.stringify(primGraphRaw)) }
            }]
        }]
    },
    metadata_props: [{ key: 'metagraph_type', value: 'checkpoint' }],
    producer_name: 'cvflowbackend'
});

describe('ambapb attachCheckpoint editing flags', () => {
    it('reports canEdit false before attachCheckpoint', () => {
        const viewModel = { _exportable: true, _metadata: [], _modules: [] };
        assert.equal(canEditCheckpoint(viewModel), false);
        assert.equal(canExportCheckpoint(viewModel), false);
    });

    it('enables canEdit after attachCheckpoint', () => {
        const primGraph = loadSyntheticPrimGraph();
        const viewModel = { _exportable: true, _metadata: [], _modules: [] };
        attachCheckpoint(viewModel, buildCheckpointProto(primGraph.raw));
        assert.equal(viewModel._ambapb.canEdit, true);
    });

    it('tracks canExport separately from canEdit', () => {
        const primGraph = loadSyntheticPrimGraph();
        const exportableModel = { _exportable: true, _metadata: [], _modules: [] };
        const readOnlyModel = { _exportable: false, _metadata: [], _modules: [] };
        attachCheckpoint(exportableModel, buildCheckpointProto(primGraph.raw));
        attachCheckpoint(readOnlyModel, buildCheckpointProto(primGraph.raw));
        assert.equal(canEditCheckpoint(exportableModel), true);
        assert.equal(canExportCheckpoint(exportableModel), true);
        assert.equal(canEditCheckpoint(readOnlyModel), true);
        assert.equal(canExportCheckpoint(readOnlyModel), false);
    });

    it('re-attaching checkpoint replaces existing ambapb state', () => {
        const primGraph = loadSyntheticPrimGraph();
        const viewModel = { _exportable: true, _metadata: [], _modules: [] };
        attachCheckpoint(viewModel, buildCheckpointProto(primGraph.raw));
        const firstPrimGraph = viewModel._ambapb.primGraph;
        attachCheckpoint(viewModel, buildCheckpointProto({ primitives: [], graph_input: 'x', graph_output: 'y' }));
        assert.notEqual(viewModel._ambapb.primGraph, firstPrimGraph);
        assert.equal(viewModel._ambapb.canEdit, true);
        assert.equal(viewModel._ambapb.primGraph.raw.graph_input, 'x');
        assert.equal(Object.keys(viewModel).filter((key) => key === '_ambapb').length, 1);
    });
});
