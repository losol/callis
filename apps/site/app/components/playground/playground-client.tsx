import { SearchField } from '@eventuras/ratio-ui/forms/SearchField';
import { Select } from '@eventuras/ratio-ui/forms/Select';
import { CodeEditor } from '@eventuras/ratio-ui-codeeditor';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { type ExampleCase, searchExamples } from '../../../../../examples/playground/schema';
import { loadExamples } from './examples';
import { matchesExpected, type Outcome, runPlayground } from './run';

/** Browser-only library and evaluator; case IDs never become import paths or user-data URLs. */
export function PlaygroundClient() {
  const [examples, setExamples] = useState<readonly ExampleCase[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ExampleCase | null>(null);
  const [input, setInput] = useState('');
  const [expression, setExpression] = useState('');
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [parameters, setParameters] = useSearchParams();
  const requested = parameters.get('example');

  useEffect(() => {
    let active = true;
    loadExamples().then(
      (items) => {
        if (active) setExamples(items);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const item = examples?.find((entry) => entry.id === requested) ?? examples?.[0];
    if (!item) return;
    setSelected(item);
    setInput(item.inputText);
    setExpression(item.expression);
    setOutcome(null);
  }, [examples, requested]);

  if (!examples || !selected) {
    return (
      <section aria-label="Example library loading">
        <p role={failed ? 'alert' : 'status'}>
          {failed
            ? 'The example library could not load. Reload the page to try again.'
            : 'Loading synthetic examples…'}
        </p>
        {failed && (
          <button
            className="playground-reload"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        )}
      </section>
    );
  }

  const filtered = searchExamples(examples, query);
  const modified = input !== selected.inputText || expression !== selected.expression;
  const unknown = requested !== null && !examples.some((item) => item.id === requested);
  const expected =
    selected.expected.kind === 'result'
      ? JSON.stringify(selected.expected.value, null, 2)
      : selected.expected.phase === 'json'
        ? 'Invalid JSON'
        : `Expression error: ${selected.expected.code}`;

  function run(json = input) {
    setInput(json);
    setOutcome(runPlayground(json, expression));
  }

  function reset() {
    if (!selected) return;
    setInput(selected.inputText);
    setExpression(selected.expression);
    setOutcome(null);
  }

  return (
    <>
      <section className="playground-library" aria-label="Synthetic example library">
        <div className="playground-picker">
          <div>
            <p className="playground-field-label">Search examples</p>
            <SearchField
              aria-label="Search examples"
              value={query}
              onChange={setQuery}
              debounce={0}
              placeholder="Search a title, question or tag…"
            />
          </div>
          <Select
            label="Choose example"
            options={filtered.map((item) => ({ value: item.id, label: item.title }))}
            selectedKey={filtered.some((item) => item.id === selected.id) ? selected.id : null}
            placeholder={filtered.length === 0 ? 'No matching examples' : 'Choose an example'}
            isDisabled={filtered.length === 0}
            onSelectionChange={(id) => {
              if (id === null) return;
              setParameters(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  next.set('example', id);
                  return next;
                },
                { replace: true, preventScrollReset: true },
              );
            }}
          />
        </div>
        <p role="status" className="playground-search-status">
          {filtered.length === 0
            ? 'No examples match your search.'
            : `${filtered.length} ${filtered.length === 1 ? 'example' : 'examples'} found.`}
        </p>
        {unknown && <p>Unknown example ID. Showing the default example.</p>}
      </section>
      <section className="playground-story" aria-labelledby="example-title">
        <h2 id="example-title">{selected.title}</h2>
        <p>{selected.summary}</p>
        <p>{selected.narrative}</p>
        <h3>{selected.question}</h3>
        <p>{selected.explanation}</p>
        <details>
          <summary>Edge cases and provenance</summary>
          <ul>
            {selected.edgeCases.map((edge) => (
              <li key={edge}>{edge}</li>
            ))}
          </ul>
          <p>
            Tags: {selected.tags.join(', ')}. Requires model-less JSON
            {selected.requires.functions.length
              ? ` and ${selected.requires.functions.join(', ')}`
              : ''}
            .
          </p>
          <p>
            {selected.source.note}{' '}
            <a
              href={`https://github.com/losol/callis/blob/${selected.source.revision}/${selected.source.path}`}
            >
              Source test pattern
            </a>{' '}
            ({selected.source.license}).
          </p>
        </details>
        <a href={`?example=${selected.id}`}>Link to this example</a>
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
              <button type="button" onClick={reset}>
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
              className="playground-panel playground-expected"
              aria-labelledby="expected-heading"
            >
              <h2 id="expected-heading">Original expected outcome</h2>
              <p>
                {modified
                  ? 'Modified example: this expectation applies only to the original input and expression.'
                  : 'Expectation for the original input and expression.'}
              </p>
              <pre>
                <code>{expected}</code>
              </pre>
            </section>
            <section
              className="playground-panel playground-output"
              aria-labelledby="result-heading"
            >
              <h2 id="result-heading">Actual result</h2>
              <p role="status">
                {outcome?.kind === 'result'
                  ? `${outcome.count} ${outcome.count === 1 ? 'item' : 'items'}`
                  : outcome?.kind === 'error'
                    ? 'Run failed.'
                    : 'Run an expression to see its result. Editing clears the previous result.'}
              </p>
              <p className="playground-comparison" aria-live="polite">
                {!outcome
                  ? 'Not compared yet.'
                  : modified
                    ? 'Modified run: original expectation shown for reference.'
                    : matchesExpected(outcome, selected.expected)
                      ? 'Matches original expectation.'
                      : 'Does not match original expectation.'}
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
          operators, plus <code>where()</code>, <code>exists()</code> and <code>count()</code>.
          Functions such as <code>resolve()</code> are not available yet. Unsupported expressions
          report an error.
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
            Their license notices are retained in the distributed dependencies.{' '}
            <a href="/playground-notices.txt">Editor and CodeMirror license notices</a>.
          </p>
        </details>
      </aside>
    </>
  );
}
