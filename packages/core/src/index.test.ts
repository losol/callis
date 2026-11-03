import { describe, expect, it } from 'vitest';
import * as api from './index.ts';

describe('@callis/core public API', () => {
  it('is empty until the first tasks add exports', () => {
    expect(Object.keys(api)).toEqual([]);
  });
});
