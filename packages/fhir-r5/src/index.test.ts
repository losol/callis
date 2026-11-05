import { describeGeneratedProvider } from '../../../tools/model-gen/src/provider-contract.ts';
import { r5 } from './index.ts';
import { modelData } from './model-data.ts';

describeGeneratedProvider(r5, modelData);
