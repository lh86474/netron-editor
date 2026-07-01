/* 
 * This file tests the editing logic for the prim_graph
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CVFLOW_NVP_OP_TYPE } from '../source/ambapb-editor.js';
import { parsePrimGraphJson, serializePrimGraphJson } from '../source/ambapb-prim-graph.js';
import {
    buildPrimGraphJsonAfterAttributeEdit,
    filterPrimitives,
    isPrimitiveModified,
    resolveSelectedPrimitiveId,
    syncPrimitiveAttribute
} from '../source/ambapb-editor.js';
import { AmbapbMetadataResolver } from '../source/ambapb-metadata.js';
import { ModelEditor } from '../source/model-editor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

const buildAmbapb = (primGraph) => ({
    primGraph,
    canEdit: true,
    canExport: false,
    imms: { entries: [], encoding: 'none' }
});

describe('ambapb prim_graph hybrid editor helpers', () => {
    // make sure that our attributes are updated in both normalized and raw primGraph
    it('syncPrimitiveAttribute updates normalized and raw entries', () => {
        const ambapb = buildAmbapb(loadSyntheticPrimGraph());
        syncPrimitiveAttribute(ambapb, 'conv0', 'stride', '4');
        assert.equal(ambapb.primGraph.primitives[1].attributes.stride, '4');
        assert.equal(ambapb.primGraph.raw.primitives[1].attributes.stride, '4');
    });

    it('buildPrimGraphJsonAfterAttributeEdit does not mutate the live primGraph', () => {
        const ambapb = buildAmbapb(loadSyntheticPrimGraph());
        const json = buildPrimGraphJsonAfterAttributeEdit(ambapb, 'conv0', 'stride', '4');
        assert.equal(ambapb.primGraph.primitives[1].attributes.stride, '2');
        const parsed = parsePrimGraphJson(json);
        assert.equal(parsed.primitives[1].attributes.stride, '4');
        assert.equal(parsed.raw.primitives[1].attributes.stride, '4');
    });

    it('filterPrimitives matches id, type, and mangled id', () => {
        const primitives = loadSyntheticPrimGraph().primitives;
        assert.equal(filterPrimitives(primitives, 'conv0').length, 1);
        assert.equal(filterPrimitives(primitives, 'conv2ibesbcp').length, 1);
        assert.equal(filterPrimitives(primitives, 'missing').length, 0);
    });

    it('isPrimitiveModified detects attribute changes', () => {
        const original = buildAmbapb(loadSyntheticPrimGraph());
        const modified = buildAmbapb(loadSyntheticPrimGraph());
        syncPrimitiveAttribute(modified, 'conv0', 'stride', '4');
        assert.equal(isPrimitiveModified(original, modified, 'conv0'), true);
        assert.equal(isPrimitiveModified(original, modified, 'data'), false);
    });

    it('resolveSelectedPrimitiveId keeps valid selection and falls back', () => {
        const ambapb = buildAmbapb(loadSyntheticPrimGraph());
        ambapb._uiState = { selectedPrimitiveId: 'conv0' };
        assert.equal(resolveSelectedPrimitiveId(ambapb, ['data', 'conv0']), 'conv0');
        ambapb._uiState.selectedPrimitiveId = 'removed';
        assert.equal(resolveSelectedPrimitiveId(ambapb, ['data', 'conv0']), 'data');
    });

    it('metadata resolver returns labels and ordered attribute keys', () => {
        AmbapbMetadataResolver.configure(JSON.parse(fs.readFileSync(
            path.join(repoRoot, 'source', 'ambapb-metadata.json'),
            'utf8'
        )));
        assert.equal(AmbapbMetadataResolver.getAttributeLabel('conv2ibesbcp', 'w'), 'width');
        assert.deepEqual(
            AmbapbMetadataResolver.getOrderedAttributeKeys('conv2ibesbcp', { stride: '2', w: '112', h: '112' }),
            ['w', 'h', 'stride']
        );
    });

    it('attribute edit round-trips through ModelEditor patch', () => {
        const primGraph = loadSyntheticPrimGraph();
        const model = {
            _kind: 'amba-checkpoint',
            _modules: [{
                nodes: [{
                    name: 'data',
                    type: { name: CVFLOW_NVP_OP_TYPE },
                    attributes: [{ name: 'prim_graph', type: 'tensor', value: {} }]
                }]
            }],
            get modules() {
                return this._modules;
            }
        };
        model._ambapb = buildAmbapb(primGraph);
        const session = ModelEditor.createSession(model);
        const entityId = 'graph:0/node:0/attr:0';
        const json = buildPrimGraphJsonAfterAttributeEdit(model._ambapb, 'conv0', 'stride', '4');
        session.history.checkpoint(session);
        session.applyPatch({
            entityId,
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.prim_graph',
            newValue: json
        });
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '4');
        session.history.undo(session);
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '2');
    });
});
