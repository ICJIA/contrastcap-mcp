import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSelector } from '../src/utils/selectorValidate.js';

describe('validateSelector', () => {
  it('accepts plain CSS selectors', () => {
    assert.equal(validateSelector('nav.main > ul > li:nth-child(3) > a'),
                                  'nav.main > ul > li:nth-child(3) > a');
    assert.equal(validateSelector('#main'),                  '#main');
    assert.equal(validateSelector('.btn-primary'),           '.btn-primary');
    assert.equal(validateSelector('a[href^="https://"]'),    'a[href^="https://"]');
    assert.equal(validateSelector('div, span, p'),           'div, span, p');
  });

  it('rejects empty / oversized / non-string', () => {
    assert.throws(() => validateSelector(''),               { message: 'Invalid selector' });
    assert.throws(() => validateSelector(null),             { message: 'Invalid selector' });
    assert.throws(() => validateSelector(undefined),        { message: 'Invalid selector' });
    assert.throws(() => validateSelector('a'.repeat(2000)), { message: 'Invalid selector' });
  });

  it('rejects Playwright xpath= engine prefix', () => {
    assert.throws(() => validateSelector('xpath=//script/text()'), { message: 'Invalid selector' });
    assert.throws(() => validateSelector('XPATH=//*'),             { message: 'Invalid selector' });
    assert.throws(() => validateSelector(' xpath=//*'),            { message: 'Invalid selector' });
  });

  it('rejects Playwright text= engine prefix', () => {
    assert.throws(() => validateSelector('text=Sign in'),  { message: 'Invalid selector' });
    assert.throws(() => validateSelector('text="Login"'),  { message: 'Invalid selector' });
  });

  it('rejects other Playwright engine prefixes', () => {
    assert.throws(() => validateSelector('id=main'),                 { message: 'Invalid selector' });
    assert.throws(() => validateSelector('css=div'),                 { message: 'Invalid selector' });
    assert.throws(() => validateSelector('role=button'),             { message: 'Invalid selector' });
    assert.throws(() => validateSelector('data-testid=submit'),      { message: 'Invalid selector' });
    assert.throws(() => validateSelector('internal:control=button'), { message: 'Invalid selector' });
    assert.throws(() => validateSelector('_react=Button'),           { message: 'Invalid selector' });
    assert.throws(() => validateSelector('_vue=Button'),             { message: 'Invalid selector' });
  });

  it('rejects Playwright >> chain operator', () => {
    assert.throws(() => validateSelector('div >> span'),   { message: 'Invalid selector' });
    assert.throws(() => validateSelector('div >>> span'),  { message: 'Invalid selector' });
  });

  it('still accepts CSS child combinator (single >)', () => {
    assert.equal(validateSelector('div > span'), 'div > span');
    assert.equal(validateSelector('ul > li'),    'ul > li');
  });
});
