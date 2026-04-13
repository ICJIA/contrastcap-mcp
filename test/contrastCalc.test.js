import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeLuminance,
  contrastRatio,
  requiredRatio,
  meetsThreshold,
  parseRgbString,
  rgbToHex,
} from '../src/engine/contrastCalc.js';

describe('relativeLuminance', () => {
  it('returns 1.0 for white', () => {
    assert.equal(relativeLuminance('#ffffff'), 1);
  });
  it('returns 0 for black', () => {
    assert.equal(relativeLuminance('#000000'), 0);
  });
  it('returns ~0.2159 for 50% gray', () => {
    const L = relativeLuminance('#808080');
    assert.ok(Math.abs(L - 0.2159) < 0.001, `got ${L}`);
  });
  it('accepts 3-char hex', () => {
    assert.equal(relativeLuminance('#fff'), 1);
    assert.equal(relativeLuminance('#000'), 0);
  });
  it('rejects invalid hex', () => {
    assert.throws(() => relativeLuminance('xyz'));
    assert.throws(() => relativeLuminance('#gg0000'));
  });
});

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  });
  it('same color is 1:1', () => {
    assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
    assert.equal(contrastRatio('#808080', '#808080'), 1);
  });
  it('classic AA boundary #767676 on white is ~4.54', () => {
    const r = contrastRatio('#767676', '#ffffff');
    assert.ok(Math.abs(r - 4.54) < 0.05, `got ${r}`);
  });
  it('is symmetric', () => {
    assert.equal(contrastRatio('#ff0000', '#00ff00'), contrastRatio('#00ff00', '#ff0000'));
  });
});

describe('requiredRatio', () => {
  it('AA normal = 4.5', () => {
    assert.equal(requiredRatio(false, 'AA'), 4.5);
  });
  it('AA large = 3', () => {
    assert.equal(requiredRatio(true, 'AA'), 3);
  });
  it('AAA normal = 7', () => {
    assert.equal(requiredRatio(false, 'AAA'), 7);
  });
  it('AAA large = 4.5', () => {
    assert.equal(requiredRatio(true, 'AAA'), 4.5);
  });
  it('defaults to AA when level omitted', () => {
    assert.equal(requiredRatio(false), 4.5);
  });
});

describe('meetsThreshold', () => {
  it('AA normal: 4.5 passes, 4.49 fails', () => {
    assert.equal(meetsThreshold(4.5, false, 'AA'), true);
    assert.equal(meetsThreshold(4.49, false, 'AA'), false);
  });
  it('AA large: 3.0 passes, 2.99 fails', () => {
    assert.equal(meetsThreshold(3.0, true, 'AA'), true);
    assert.equal(meetsThreshold(2.99, true, 'AA'), false);
  });
  it('AAA normal: 7.0 passes, 6.99 fails', () => {
    assert.equal(meetsThreshold(7.0, false, 'AAA'), true);
    assert.equal(meetsThreshold(6.99, false, 'AAA'), false);
  });
});

describe('parseRgbString', () => {
  it('parses rgb()', () => {
    assert.deepEqual(parseRgbString('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 });
  });
  it('parses rgba()', () => {
    assert.deepEqual(parseRgbString('rgba(255, 0, 128, 0.5)'), { r: 255, g: 0, b: 128 });
  });
  it('handles whitespace', () => {
    assert.deepEqual(parseRgbString('rgb( 1 , 2 , 3 )'), { r: 1, g: 2, b: 3 });
  });
  it('rejects nonsense', () => {
    assert.throws(() => parseRgbString('blue'));
  });
});

describe('rgbToHex', () => {
  it('converts 0,0,0 to #000000', () => {
    assert.equal(rgbToHex(0, 0, 0), '#000000');
  });
  it('converts 255,255,255 to #ffffff', () => {
    assert.equal(rgbToHex(255, 255, 255), '#ffffff');
  });
  it('pads single hex digits', () => {
    assert.equal(rgbToHex(1, 2, 3), '#010203');
  });
  it('clamps out-of-range', () => {
    assert.equal(rgbToHex(300, -10, 128), '#ff0080');
  });
});
