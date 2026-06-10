import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    stripExportExtension,
    sanitizeExportBasename,
    buildSubgraphExportBasename,
    normalizeExportFilename
} from '../source/export-filename.js';

describe('export filename helpers', () => {
    it('stripExportExtension removes trailing extension', () => {
        assert.equal(stripExportExtension('model.onnx'), 'model');
        assert.equal(stripExportExtension('path/to/model.onnx'), 'path/to/model');
        assert.equal(stripExportExtension('model'), 'model');
    });

    it('sanitizeExportBasename removes invalid characters', () => {
        assert.equal(sanitizeExportBasename('my model'), 'my_model');
        assert.equal(sanitizeExportBasename('bad/name:onnx'), 'bad_name_onnx');
        assert.equal(sanitizeExportBasename(''), 'model');
    });

    it('buildSubgraphExportBasename uses node names when available', () => {
        assert.equal(
            buildSubgraphExportBasename('resnet50.onnx', 'Conv1', 'Relu1'),
            'resnet50_Conv1_to_Relu1'
        );
    });

    it('buildSubgraphExportBasename falls back to _subgraph', () => {
        assert.equal(buildSubgraphExportBasename('model.onnx', '', ''), 'model_subgraph');
    });

    it('normalizeExportFilename adds extension when missing', () => {
        assert.equal(normalizeExportFilename('slice', 'onnx'), 'slice.onnx');
        assert.equal(normalizeExportFilename('slice.onnx', 'onnx'), 'slice.onnx');
        assert.equal(normalizeExportFilename('  ', 'onnx'), null);
    });
});
