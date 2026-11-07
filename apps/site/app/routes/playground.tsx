import { type ComponentType, useEffect, useState } from 'react';

import playgroundStylesheet from './playground.css?url';

export function links() {
  return [{ rel: 'stylesheet', href: playgroundStylesheet }];
}

export function meta() {
  return [{ title: 'FHIRPath playground · Callis' }];
}

export default function PlaygroundPage() {
  const [Client, setClient] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // Neither the editor nor the evaluator runs during prerendering or on docs pages.
    import('../components/playground/playground-client').then(
      ({ PlaygroundClient }) => {
        if (active) setClient(() => PlaygroundClient);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="playground">
      <header className="playground-intro">
        <h1>FHIRPath playground</h1>
        <p>Run FHIRPath on JSON. Everything stays in this browser.</p>
      </header>
      {Client ? (
        <Client />
      ) : (
        <section aria-label="Playground loading">
          <p role={failed ? 'alert' : 'status'}>
            {failed
              ? 'The playground could not load. Reload the page to try again.'
              : 'Loading the JSON editor and evaluator…'}
          </p>
          <noscript>Enable JavaScript to edit JSON and run expressions locally.</noscript>
        </section>
      )}
    </main>
  );
}
