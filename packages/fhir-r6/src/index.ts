import type { ModelProvider } from '@callis/core';
import { modelData } from './model-data.ts';
import { createProvider } from './provider.ts';

/** Immutable FHIR R6 6.0.0-snapshot1 draft model; not a final R6 specification. */
export const r6: ModelProvider = createProvider('6.0.0-snapshot1', modelData);
