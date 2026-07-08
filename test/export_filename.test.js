/* 
 * This file contains tests for the export filename helpers
 * Renames subgraphs to _subgraph. Add .onnx extension when missing. 
 * Author: luray He
 */
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

    // This test can probably be removed since this doesn't affect the file
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
    // the most important one. We must add .onnx extension during export. 
    it('normalizeExportFilename adds extension when missing', () => {
        assert.equal(normalizeExportFilename('slice', 'onnx'), 'slice.onnx');
        assert.equal(normalizeExportFilename('slice.onnx', 'onnx'), 'slice.onnx');
        assert.equal(normalizeExportFilename('  ', 'onnx'), null);
    });

    it('sanitizeExportBasename truncates very long names', () => {
        const longName = 'a'.repeat(300);
        const sanitized = sanitizeExportBasename(longName);
        assert.equal(sanitized.length, 120);
        assert.ok(sanitized.startsWith('aaa'));
    });

    it('sanitizeExportBasename neutralizes path traversal segments', () => {
        assert.equal(sanitizeExportBasename('../../../etc/passwd.onnx'), '.._.._etc_passwd.onnx');
    });

    it('sanitizeExportBasename falls back to model when only invalid characters remain', () => {
        assert.equal(sanitizeExportBasename('::::'), 'model');
    });

    it('buildSubgraphExportBasename preserves case in node names', () => {
        assert.equal(
            buildSubgraphExportBasename('model.onnx', 'Conv', 'conv'),
            'model_Conv_to_conv'
        );
    });

    it('stripExportExtension removes only the final extension', () => {
        assert.equal(stripExportExtension('model.onnx.onnx'), 'model.onnx');
    });
});
