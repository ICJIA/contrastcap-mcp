import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLargeText } from '../src/utils/largeText.js';

describe('isLargeText', () => {
  it('16px normal is not large', () => {
    assert.equal(isLargeText(16, '400'), false);
  });
  it('24px normal is large', () => {
    assert.equal(isLargeText(24, '400'), true);
  });
  it('23.99px normal is not large', () => {
    assert.equal(isLargeText(23.99, '400'), false);
  });
  it('18.66px bold (700) is large', () => {
    assert.equal(isLargeText(18.66, '700'), true);
  });
  it('18.66px normal (400) is not large', () => {
    assert.equal(isLargeText(18.66, '400'), false);
  });
  it('18.65px bold is not large', () => {
    assert.equal(isLargeText(18.65, '700'), false);
  });
  it('accepts "NNpx" string input', () => {
    assert.equal(isLargeText('14px', '400'), false);
    assert.equal(isLargeText('24px', '400'), true);
  });
  it('falls back to 400 weight for non-numeric', () => {
    assert.equal(isLargeText(20, 'normal'), false);
    assert.equal(isLargeText(20, undefined), false);
  });
  it('returns false for garbage size', () => {
    assert.equal(isLargeText('abc', '400'), false);
    assert.equal(isLargeText(undefined, '400'), false);
  });
});
