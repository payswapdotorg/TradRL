// Tests for the view tree (render/vtree.ts) — pure structure, no DOM.
//
// Laws pinned here (vtree.ts header): VNodes are pure DATA (tag,
// closed-vocabulary attrs, children); the builder flattens and drops
// null/undefined children; serialization is the DETERMINISM PIN at the
// render level (identical models -> identical bytes, with escaping).

import { describe, expect, it } from 'vitest';
import { isVNode, serializeVNode, v } from './vtree';

describe('vtree: the builder', () => {
  it('builds a frozen node with tag, attrs and children', () => {
    const node = v('div', { class: 'card' }, ['hello', v('span', {}, ['world'])]);
    expect(node.tag).toBe('div');
    expect(node.attrs).toEqual({ class: 'card' });
    expect(node.children).toHaveLength(2);
    expect(node.children[1]).toMatchObject({ tag: 'span' });
  });

  it('drops null/undefined children (top-level list, the builder\'s contract)', () => {
    const node = v('ul', {}, ['a', null, undefined, 'b', v('li', {}, ['c'])]);
    expect(node.children.map((child) => (typeof child === 'string' ? child : child.tag))).toEqual(['a', 'b', 'li']);
    expect(node.children).toHaveLength(3);
  });

  it('defaults: no attrs, no children', () => {
    const node = v('br');
    expect(node.attrs).toEqual({});
    expect(node.children).toEqual([]);
  });

  it('isVNode guards the shape (and nothing else)', () => {
    expect(isVNode(v('div'))).toBe(true);
    expect(isVNode('div')).toBe(false);
    expect(isVNode(null)).toBe(false);
    expect(isVNode({ tag: 1, attrs: {}, children: [] })).toBe(false);
    expect(isVNode({ tag: 'div', attrs: null, children: [] })).toBe(false);
    expect(isVNode({ tag: 'div', attrs: {}, children: 'no' })).toBe(false);
  });
});

describe('vtree: serialization (THE RENDER DETERMINISM PIN)', () => {
  it('serializes elements, attributes and text in tree order', () => {
    expect(serializeVNode(v('div', { class: 'a' }, ['x', v('b', {}, ['y'])]))).toBe('<div class="a">x<b>y</b></div>');
  });

  it('empty elements serialize to open+close tags', () => {
    expect(serializeVNode(v('span', {}, []))).toBe('<span></span>');
    expect(serializeVNode(v('img', { src: 'x' }))).toBe('<img src="x"></img>');
  });

  it('escapes text and attribute values (never markup injection)', () => {
    expect(serializeVNode(v('p', {}, ['<script>&"']))).toBe('<p>&lt;script&gt;&amp;"</p>');
    expect(serializeVNode(v('p', {}, ["it's"]))).toBe("<p>it's</p>");
    expect(serializeVNode(v('p', { title: 'a"b<c' }, []))).toBe('<p title="a&quot;b&lt;c"></p>');
    expect(serializeVNode('5 < 6 & 7 > 2')).toBe('5 &lt; 6 &amp; 7 &gt; 2');
  });

  it('DETERMINISM: identical models serialize to identical bytes', () => {
    const model = v('section', { 'data-section': 'goal' }, [
      v('h2', {}, ['Goal']),
      v('div', { class: 'card' }, [v('div', { class: 'card-title' }, ['T']), v('div', { class: 'fact' }, ['<k>', 'v'])]),
    ]);
    expect(serializeVNode(model)).toBe(serializeVNode(model));
    const rebuilt = v('section', { 'data-section': 'goal' }, [
      v('h2', {}, ['Goal']),
      v('div', { class: 'card' }, [v('div', { class: 'card-title' }, ['T']), v('div', { class: 'fact' }, ['<k>', 'v'])]),
    ]);
    expect(serializeVNode(rebuilt)).toBe(serializeVNode(model));
  });

  it('attrs serialize in object order (stable across identical builds)', () => {
    const first = v('div', { a: '1', b: '2' }, []);
    const second = v('div', { a: '1', b: '2' }, []);
    expect(serializeVNode(second)).toBe(serializeVNode(first));
  });
});
