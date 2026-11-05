import { describeGeneratedProvider } from '../../../tools/model-gen/src/provider-contract.ts';
import { r4 } from './index.ts';
import { modelData } from './model-data.ts';

describeGeneratedProvider(r4, modelData);
