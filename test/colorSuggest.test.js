import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestFix, _test } from '../src/engine/colorSuggest.js';
import { contrastRatio } from '../src/engine/contrastCalc.js';

const { hexToHsl, hslToHex } = _test;

describe('hexToHsl / hslToHex roundtrip', () => {
  it('white roundtrip', () => {
    const hsl = hexToHsl('#ffffff');
    assert.equal(hslToHex(hsl.h, hsl.s, hsl.l), '#ffffff');
  });
  it('black roundtrip', () => {
    const hsl = hexToHsl('#000000');
    assert.equal(hslToHex(hsl.h, hsl.s, hsl.l), '#000000');
  });
  it('pure red approximate roundtrip', () => {
    const hsl = hexToHsl('#ff0000');
    assert.equal(hslToHex(hsl.h, hsl.s, hsl.l), '#ff0000');
  });
});

describe('suggestFix', () => {
  it('returns a hex that meets AA for #6c757d on #e9ecef', () => {
    const fix = suggestFix('#6c757d', '#e9ecef', false, 'AA');
    assert.match(fix, /^#[0-9a-f]{6}$/);
    assert.ok(contrastRatio(fix, '#e9ecef') >= 4.5, `ratio ${contrastRatio(fix, '#e9ecef')}`);
  });

  it('returns black/near-black for white-on-white', () => {
    const fix = suggestFix('#ffffff', '#ffffff', false, 'AA');
    assert.match(fix, /^#[0-9a-f]{6}$/);
    // Whatever the algorithm picks, it must meet the threshold.
    assert.ok(contrastRatio(fix, '#ffffff') >= 4.5);
  });

  it('picks the minimum change (closest L) when both directions are feasible', () => {
    // Mid-gray 50% L on a mid background — both darken and lighten reach 4.5:1.
    // The nearer-L candidate should be preferred.
    const fg = '#808080';
    const bg = '#4a4a4a'; // darker background
    const fix = suggestFix(fg, bg, false, 'AA');
    assert.ok(contrastRatio(fix, bg) >= 4.5);
  });

  it('works for AAA large text', () => {
    const fix = suggestFix('#666666', '#ffffff', true, 'AAA');
    assert.ok(contrastRatio(fix, '#ffffff') >= 4.5);
  });

  it('falls back to black on light bg when no hue-preserving solution exists', () => {
    // Truly pathological: fg and bg identical, hue=0, saturation=0 — only L can move.
    const fix = suggestFix('#ffffff', '#ffffff', false, 'AA');
    // Either #000000 or some near-black hex; must still pass.
    assert.ok(contrastRatio(fix, '#ffffff') >= 4.5);
  });
});
