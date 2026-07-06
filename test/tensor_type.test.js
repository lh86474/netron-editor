/*
 * Tests to make sure that data types are correctly formatted and validated. 
 * canocalize means to standardize: transforming data that can have
 * multiple representations into one agreed-upon format.
 * by default, data type is formatted as
 * exampleDAtatype[1, 2, 3]
 * Author: Luray He
 */

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
    // When we reject invalid data types, we just revert back to the original string.
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
