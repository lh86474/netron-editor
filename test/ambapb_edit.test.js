import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachCheckpoint } from '../source/ambapb.js';
import { parsePrimGraphJson } from '../source/ambapb-prim-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

describe('ambapb attachCheckpoint editing flags', () => {
    it('enables canEdit after attachCheckpoint', () => {
        const primGraph = loadSyntheticPrimGraph();
        const viewModel = { _exportable: true, _metadata: [], _modules: [] };
        attachCheckpoint(viewModel, {
            graph: {
                node: [{
                    op_type: 'CVFlowNVP',
                    attribute: [{
                        name: 'prim_graph',
                        t: { raw_data: new TextEncoder().encode(JSON.stringify(primGraph.raw)) }
                    }]
                }]
            },
            metadata_props: [{ key: 'metagraph_type', value: 'checkpoint' }],
            producer_name: 'cvflowbackend'
        });
        assert.equal(viewModel._ambapb.canEdit, true);
    });
});
