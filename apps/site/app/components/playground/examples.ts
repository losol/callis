import { type ExampleCase, readExamples } from '../../../../../examples/playground/schema';

/** Twelve small cases share one separately loaded data chunk, with no duplicated picker catalog. */
export async function loadExamples(): Promise<readonly ExampleCase[]> {
  const { default: text } = await import(
    '../../../../../examples/playground/case-library.json?raw'
  );
  return readExamples(JSON.parse(text));
}
