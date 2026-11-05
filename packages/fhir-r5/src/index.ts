import type { ModelProvider } from '@callis/core';
import { modelData } from './model-data.ts';
import { createProvider } from './provider.ts';

/** Immutable FHIR R5 5.0.0 model for type-directed navigation and type tests. */
export const r5: ModelProvider = createProvider('5.0.0', modelData);
