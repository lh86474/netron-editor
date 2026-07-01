import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    canonicalizeTensorTypeString,
    tensorTypeShapeDimensions,
    TensorTypeError
} from '../source/tensor-type.js';

describe('tensor-type', () => {
    it('canonicalizes scalar and shaped types', () => {
        assert.equal(canonicalizeTensorTypeString('FLOAT32'), 'float32');
        assert.equal(canonicalizeTensorTypeString('float32[1, 2]'), 'float32[1,2]');
        assert.equal(canonicalizeTensorTypeString('int64[batch]'), 'int64[batch]');
    });

    it('rejects invalid types', () => {
        assert.throws(() => canonicalizeTensorTypeString('not_a_type'), TensorTypeError);
        assert.throws(() => canonicalizeTensorTypeString('float32[1-2]'), TensorTypeError);
        assert.throws(() => canonicalizeTensorTypeString('float32[1,]'), TensorTypeError);
    });

    it('extracts shape dimensions from string types', () => {
        assert.deepEqual(tensorTypeShapeDimensions('float32[1,2]'), [1n, 2n]);
        assert.deepEqual(tensorTypeShapeDimensions('int64[batch]'), ['batch']);
        assert.equal(tensorTypeShapeDimensions('float32'), null);
    });
});
