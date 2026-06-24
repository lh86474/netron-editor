import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

class GraphBlockExpansion {
    constructor() {
        this.blocks = new Set();
    }

    blockKey(hostEntityId, attrName) {
        if (!hostEntityId || !attrName) {
            return null;
        }
        return `${hostEntityId}/${attrName}`;
    }

    isBlockExpanded(blockKey) {
        return Boolean(blockKey && this.blocks.has(blockKey));
    }

    toggleBlockExpanded(blockKey) {
        if (!blockKey) {
            return false;
        }
        if (this.blocks.has(blockKey)) {
            this.blocks.delete(blockKey);
            return false;
        }
        this.blocks.add(blockKey);
        return true;
    }
}

describe('graph block expansion keys', () => {
    it('expands one host/attribute pair without affecting another sharing the same subgraph object', () => {
        const sharedSubgraph = { name: 'subgraph_nvp0', nodes: [] };
        const ctx = new GraphBlockExpansion();

        const keyA = ctx.blockKey('graph:0/node:3', 'compiled_prim_graph');
        const keyB = ctx.blockKey('graph:0/node:9/compiled_prim_graph/node:2', 'compiled_prim_graph');

        assert.notEqual(keyA, keyB);
        ctx.toggleBlockExpanded(keyA);

        assert.equal(ctx.isBlockExpanded(keyA), true);
        assert.equal(ctx.isBlockExpanded(keyB), false);
        assert.equal(ctx.blocks.has(sharedSubgraph), false);
    });
});
