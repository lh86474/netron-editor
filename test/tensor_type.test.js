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

    it('rejects nested bracket shapes', () => {
        assert.throws(() => canonicalizeTensorTypeString('float32[][]'), TensorTypeError);
    });

    it('canonicalizes long rank shapes', () => {
        assert.equal(
            canonicalizeTensorTypeString('float32[1,2,3,4,5,6,7,8,9,10]'),
            'float32[1,2,3,4,5,6,7,8,9,10]'
        );
        assert.deepEqual(
            tensorTypeShapeDimensions('float32[1,2,3,4,5,6,7,8,9,10]'),
            [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]
        );
    });

    it('canonicalizes whitespace around type names and dimensions', () => {
        assert.equal(canonicalizeTensorTypeString(' float32 [ 1 , 2 ] '), 'float32[1,2]');
    });

    it('rejects unknown symbolic dimensions during canonicalization', () => {
        assert.throws(() => canonicalizeTensorTypeString('float32[?]'), TensorTypeError);
        assert.deepEqual(tensorTypeShapeDimensions('float32[?]'), ['?']);
    });

    it('rejects fullwidth bracket characters', () => {
        assert.throws(() => canonicalizeTensorTypeString('float32［1］'), TensorTypeError);
    });

    it('returns empty string for blank input values', () => {
        assert.equal(canonicalizeTensorTypeString(''), '');
        assert.equal(canonicalizeTensorTypeString('   '), '');
        assert.equal(canonicalizeTensorTypeString(null), '');
        assert.equal(canonicalizeTensorTypeString(undefined), '');
    });
});
