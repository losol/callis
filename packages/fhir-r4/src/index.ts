import type { ModelProvider } from '@callis/core';
import { createProvider } from '../../../tools/model-gen/runtime/create-provider.ts';
import { modelData } from './model-data.ts';

/** Immutable FHIR R4 4.0.1 model for type-directed navigation and type tests. */
export const r4: ModelProvider = createProvider('4.0.1', modelData);
