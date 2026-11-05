import type { ModelTypeKind, SystemTypeName } from '@callis/core';

/** Private wire format: element name, model type names, flags (array=1, choice=2). */
export type ElementRow = readonly [string, readonly string[], number];

/** Private wire format: name, kind, base, abstractness, System mapping, snapshot children. */
export type TypeRow = readonly [
  string,
  ModelTypeKind,
  string | null,
  boolean,
  Exclude<SystemTypeName, 'Any'> | null,
  readonly ElementRow[],
];
