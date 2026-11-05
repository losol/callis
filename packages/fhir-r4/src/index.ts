import type { ModelProvider } from '@callis/core';
import { modelData } from './model-data.ts';
import { createProvider } from './provider.ts';

/** Immutable FHIR R4 4.0.1 model for type-directed navigation and type tests. */
export const r4: ModelProvider = createProvider('4.0.1', modelData);
