import { Badge } from '@eventuras/ratio-ui/core/Badge';
import { Button } from '@eventuras/ratio-ui/core/Button';
import { Kbd } from '@eventuras/ratio-ui/core/Kbd';
import { ToggleButton } from '@eventuras/ratio-ui/core/ToggleButton';
import { SearchField } from '@eventuras/ratio-ui/forms/SearchField';
import { Select } from '@eventuras/ratio-ui/forms/Select';
import { CodeEditor } from '@eventuras/ratio-ui-codeeditor';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { type ExampleCase, searchExamples } from '../../../../../examples/playground/schema';
import { loadExamples } from './examples';
import { matchesExpected, type Outcome, runPlayground } from './run';

type Comparison = 'not-run' | 'edited' | 'matches' | 'differs';

/** Short status of the latest run against the example's original expectation. */
const comparisons: Record<
  Comparison,
  { label: string; status: 'neutral' | 'info' | 'success' | 'warning' }
> = {
  'not-run': { label: 'Not run', status: 'neutral' },
  edited: { label: 'Edited example', status: 'info' },
  matches: { label: 'Matches expected', status: 'success' },
  differs: { label: 'Differs from expected', status: 'warning' },
};

/** Browser-only library and evaluator; case IDs never become import paths or user-data URLs. */
export function PlaygroundClient() {
  const [examples, setExamples] = useState<readonly ExampleCase[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ExampleCase | null>(null);
  const [input, setInput] = useState('');
  const [expression, setExpression] = useState('');
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [explain, setExplain] = useState(false);
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
  const comparison: Comparison = !outcome
    ? 'not-run'
    : modified
      ? 'edited'
      : matchesExpected(outcome, selected.expected)
        ? 'matches'
        : 'differs';

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
      <section className="playground-toolbar" aria-label="Synthetic example library">
        <div className="playground-search">
          <SearchField
            size="sm"
            aria-label="Search examples"
            value={query}
            onChange={setQuery}
            debounce={0}
            placeholder="Filter examples"
          />
        </div>
        <div className="playground-picker">
          <Select
            size="sm"
            aria-label="Choose example"
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
        <ToggleButton
          variant="chip"
          size="sm"
          className="playground-explain-toggle"
          isSelected={explain}
          onChange={setExplain}
          aria-controls="playground-explain"
        >
          Explain
        </ToggleButton>
        <p role="status" className="playground-search-status playground-visually-hidden">
          {filtered.length === 0
            ? 'No examples match your search.'
            : `${filtered.length} ${filtered.length === 1 ? 'example' : 'examples'} found.`}
        </p>
        {unknown && (
          <p className="playground-notice">Unknown example ID. Showing the default example.</p>
        )}
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <div className="playground-prompt">
          <label htmlFor="expression">
            <span aria-hidden="true">fhirpath ›</span>
            <span className="playground-visually-hidden">FHIRPath expression</span>
          </label>
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
          <Button type="submit" variant="primary" size="sm" aria-label="Run expression">
            Run
          </Button>
          <span id="expression-help" className="playground-keys">
            <Kbd>Ctrl</Kbd>
            <span aria-hidden="true">/</span>
            <span className="playground-visually-hidden"> or </span>
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd>
            <span className="playground-visually-hidden"> runs the expression</span>
          </span>
        </div>

        <div className="playground-workspace" data-explain={explain || undefined}>
          <section aria-labelledby="json-heading" className="playground-pane">
            <div className="playground-pane-heading">
              <h2 id="json-heading">
                <span aria-hidden="true">input.json</span>
                <span className="playground-visually-hidden">Input JSON</span>
              </h2>
              <Button
                type="button"
                variant="text"
                size="sm"
                aria-label="Reset example"
                onPress={reset}
              >
                Reset
              </Button>
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

          <section
            className="playground-pane playground-output"
            aria-labelledby="result-heading"
            data-comparison={comparison}
          >
            <div className="playground-pane-heading">
              <h2 id="result-heading">
                <span aria-hidden="true">output</span>
                <span className="playground-visually-hidden">Actual result</span>
              </h2>
              <p className="playground-comparison" aria-live="polite">
                <Badge variant="subtle" status={comparisons[comparison].status}>
                  {comparisons[comparison].label}
                </Badge>
              </p>
            </div>
            <div className="playground-pane-body">
              <p role="status" className="playground-count">
                {outcome?.kind === 'result'
                  ? `${outcome.count} ${outcome.count === 1 ? 'item' : 'items'}`
                  : outcome?.kind === 'error'
                    ? 'Run failed.'
                    : 'Run to see the result.'}
              </p>
              {outcome?.kind === 'result' && (
                <pre className="playground-result">
                  <code>{outcome.text}</code>
                </pre>
              )}
              {outcome?.kind === 'error' && (
                <div role="alert">
                  <h3>{outcome.area}</h3>
                  <pre>{outcome.text}</pre>
                </div>
              )}
              <details className="playground-expected" open={comparison !== 'matches'}>
                <summary>expected</summary>
                {modified && <p>Edited example: this is the expectation for the original input.</p>}
                <pre>
                  <code>{expected}</code>
                </pre>
              </details>
            </div>
          </section>

          {explain && (
            <aside
              id="playground-explain"
              className="playground-explain"
              aria-labelledby="example-title"
            >
              <p className="playground-eyebrow">
                Example {examples.indexOf(selected) + 1} of {examples.length}
              </p>
              <h2 id="example-title">{selected.title}</h2>
              <p>{selected.summary}</p>
              <h3>{selected.question}</h3>
              <p>{selected.narrative}</p>
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
              <details>
                <summary>What the preview supports</summary>
                <p>
                  Model-less navigation, literals, indexing and the implemented operators, plus{' '}
                  <code>where()</code>, <code>exists()</code>, <code>count()</code>,{' '}
                  <code>first()</code> and <code>single()</code>. Functions such as{' '}
                  <code>resolve()</code> are not available yet. Unsupported expressions report an
                  error.
                </p>
                <p>
                  Computed decimals are displayed as exact strings, including quantity values. Input
                  uses JavaScript’s JSON parser: large or precise JSON numbers may already lose
                  precision when parsed.
                </p>
                <p>Loading another example replaces both fields.</p>
              </details>
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
                  , and CodeMirror under MIT. The site uses Lectio Docs (MIT) and Ratio UI
                  (MPL-2.0). Their license notices are retained in the distributed dependencies.{' '}
                  <a href="/playground-notices.txt">Editor and CodeMirror license notices</a>.
                </p>
              </details>
              <a href={`?example=${selected.id}`}>Link to this example</a>
            </aside>
          )}
        </div>
      </form>

      <footer className="playground-statusbar">
        <span>
          <span className="playground-dot" data-comparison={comparison} aria-hidden="true" />
          Runs in this browser · nothing is uploaded or saved
        </span>
        <nav aria-label="Implementation status">
          <a href="/roadmap">Roadmap</a>
          <a href="/conformance/r4">R4 conformance</a>
          <a href="/conformance/r5">R5 conformance</a>
        </nav>
      </footer>
    </>
  );
}
