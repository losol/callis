import { describe, expect, it } from 'vitest';
import { validatePrTitle } from './pr-title.ts';

// Examples from CONTRIBUTING.md, "Pull request titles and commit messages".
describe('validatePrTitle', () => {
  it.each([
    'feat(core): add lexer',
    'fix(core): return empty for division by zero',
    'feat(core)!: rename evaluate option output to format',
    'docs: record UTC as default timezone',
    'build: pin tsdown 0.23',
    'ci: run the full check on Node 24 and only tests on Node 22 and 26',
    'docs(conformance): explain the baseline',
    'feat(site): add the progress page',
    'test(core): x',
  ])('accepts %j', (title) => {
    expect(validatePrTitle(title)).toEqual([]);
  });

  it.each([
    ['T0001 lexer', 'Use the form'],
    ['Scaffold the repository.', 'Use the form'],
    ['fix: fixed bug', '"fix" needs a scope'],
    ['feat: add lexer', '"feat" needs a scope'],
    ['feat(core): Breaking change in options.', 'lowercase letter'],
    ['feat(core): add lexer.', 'period'],
    ['chore(deps): bump stuff', 'Unknown scope "deps"'],
    ['docs(adr): record a decision', 'Unknown scope "adr"'],
    ['feat(core,ucum): add support', 'exactly one scope'],
    ['feat(core,ucum)!: add support', 'exactly one scope'],
    ['feat(): add lexer', 'Unknown scope ""'],
    ['feature(core): add lexer', 'Unknown type "feature"'],
    ['feat(core): 1 add lexer', 'lowercase letter'],
    ['feat(core): _add lexer', 'lowercase letter'],
    ['feat(core):add lexer', 'Use the form'],
    [`feat(core): ${'a'.repeat(70)}`, 'the limit is 72'],
  ])('rejects %j', (title, problem) => {
    expect(validatePrTitle(title).join('\n')).toContain(problem);
  });
});
