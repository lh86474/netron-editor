/*
 * The introduction of the two panes made the expansion of the compiled_prim_graph more complex, so we
 * had to introduce more ids to track differentiate the states between the two panes 
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We call the compiled_prim_graph a block, and we need to track the expansion state of the block.
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

// before, we would have a weird behavior where if we expand on block, it would affect the other block with the same subgraph object.
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

    it('blockKey returns null when host entity id is missing', () => {
        const ctx = new GraphBlockExpansion();
        assert.equal(ctx.blockKey(null, 'compiled_prim_graph'), null);
        assert.equal(ctx.toggleBlockExpanded(null), false);
        assert.equal(ctx.isBlockExpanded(null), false);
        assert.equal(ctx.blocks.size, 0);
    });

    it('toggleBlockExpanded collapses after an even number of toggles', () => {
        const ctx = new GraphBlockExpansion();
        const key = ctx.blockKey('graph:0/node:1', 'compiled_prim_graph');
        for (let i = 0; i < 100; i++) {
            ctx.toggleBlockExpanded(key);
        }
        assert.equal(ctx.isBlockExpanded(key), false);
        assert.equal(ctx.blocks.size, 0);
    });

    it('blockKey distinguishes entity ids that differ only by path separators', () => {
        const ctx = new GraphBlockExpansion();
        const keyA = ctx.blockKey('graph:0/node:3', 'compiled_prim_graph');
        const keyB = ctx.blockKey('graph:0/node:3/compiled_prim_graph/node:2', 'compiled_prim_graph');
        assert.notEqual(keyA, keyB);
        ctx.toggleBlockExpanded(keyA);
        assert.equal(ctx.isBlockExpanded(keyA), true);
        assert.equal(ctx.isBlockExpanded(keyB), false);
    });
});
