import { CodeEditor } from '@eventuras/ratio-ui-codeeditor';
import { useState } from 'react';

import { exampleInput, examples } from './examples';
import { type Outcome, runPlayground } from './run';

/** Browser-only playground using the same public API as package consumers. */
export function PlaygroundClient() {
  const [input, setInput] = useState(exampleInput);
  const [expression, setExpression] = useState<string>(examples[0].expression);
  const [selected, setSelected] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function run(json = input) {
    setOutcome(runPlayground(json, expression));
  }

  function loadExample(index: number) {
    const example = examples[index];
    if (!example) return;
    setSelected(index);
    setInput(exampleInput);
    setExpression(example.expression);
    setOutcome(null);
  }

  return (
    <>
      <section className="playground-presets" aria-label="Synthetic examples">
        <span>Start with an example</span>
        <div>
          {examples.map((example, index) => (
            <button
              key={example.name}
              type="button"
              aria-pressed={selected === index}
              onClick={() => loadExample(index)}
            >
              {example.name}
            </button>
          ))}
        </div>
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <div className="playground-workspace">
          <section aria-labelledby="json-heading" className="playground-panel">
            <div className="playground-panel-heading">
              <h2 id="json-heading">Input JSON</h2>
              <button type="button" onClick={() => loadExample(selected)}>
                Reset example
              </button>
            </div>
            <CodeEditor
              value={input}
              onChange={(value) => {
                setInput(value);
                setOutcome(null);
              }}
              language="json"
              setup="minimal"
              tabIndents={false}
              aria-label="Input JSON"
              onRun={(value) => run(value)}
            />
          </section>
          <div className="playground-query">
            <section className="playground-panel">
              <label htmlFor="expression">FHIRPath expression</label>
              <input
                id="expression"
                value={expression}
                spellCheck={false}
                autoComplete="off"
                aria-describedby="expression-help"
                onChange={(event) => {
                  setExpression(event.target.value);
                  setOutcome(null);
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    run();
                  }
                }}
              />
              <div className="playground-run">
                <button type="submit">Run expression</button>
                <span id="expression-help">Ctrl / ⌘ + Enter to run</span>
              </div>
            </section>
            <section
              className="playground-panel playground-output"
              aria-labelledby="result-heading"
            >
              <h2 id="result-heading">Result</h2>
              <p role="status">
                {outcome?.kind === 'result'
                  ? `${outcome.count} ${outcome.count === 1 ? 'item' : 'items'}`
                  : outcome?.kind === 'error'
                    ? 'Run failed.'
                    : 'Run an expression to see its result. Editing clears the previous result.'}
              </p>
              {outcome?.kind === 'result' && (
                <pre>
                  <code>{outcome.text}</code>
                </pre>
              )}
              {outcome?.kind === 'error' && (
                <div role="alert">
                  <h3>{outcome.area}</h3>
                  <pre>{outcome.text}</pre>
                </div>
              )}
            </section>
          </div>
        </div>
      </form>
      <aside className="playground-notes" aria-label="Playground limitations and sources">
        <p>
          This preview supports model-less navigation, literals, indexing and the implemented
          operators. Functions such as <code>where()</code>, <code>exists()</code> and{' '}
          <code>resolve()</code> are not available yet. Unsupported expressions report an error.
        </p>
        <p>
          Computed decimals are displayed as exact strings, including quantity values. Input uses
          JavaScript’s JSON parser: large or precise JSON numbers may already lose precision when
          parsed.
        </p>
        <p>
          No input is uploaded or saved. Loading another example replaces both fields.{' '}
          <a href="/roadmap">Implementation roadmap</a>
          {' · '}
          <a href="/conformance/r4">R4 conformance</a>
          {' · '}
          <a href="/conformance/r5">R5 conformance</a>
        </p>
        <details>
          <summary>Open source components</summary>
          <p>
            The JSON editor uses{' '}
            <a href="https://github.com/losol/ratio-ui/tree/eb696255f51f2b2489c956d8105de18d708c71fc/packages/ratio-ui-codeeditor">
              Ratio CodeEditor 0.1.1 source
            </a>
            , © Losol AS, under{' '}
            <a href="https://github.com/losol/ratio-ui/blob/eb696255f51f2b2489c956d8105de18d708c71fc/packages/ratio-ui-codeeditor/LICENSE">
              MPL-2.0
            </a>
            , and CodeMirror under MIT. The site uses Lectio Docs (MIT) and Ratio UI (MPL-2.0).
            Their license notices are retained in the distributed dependencies.
          </p>
        </details>
      </aside>
    </>
  );
}
