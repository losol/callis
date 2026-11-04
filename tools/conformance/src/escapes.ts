const ESCAPES: Readonly<Record<string, string>> = { f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Decodes the escape sequences of a FHIRPath string literal or delimited identifier, given the
 * text between the quotes or backticks ([N1 §4.1.2](https://hl7.org/fhirpath/N1/#string),
 * [§8.6](https://hl7.org/fhirpath/N1/#identifiers)). `\uXXXX` gives the code unit, `\f`, `\n`, `\r`
 * and `\t` the control characters, and any other escaped character stands for itself.
 */
export function decodeEscapes(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, sequence: string) => {
    if (sequence.startsWith('u') && sequence.length === 5) {
      return String.fromCharCode(Number.parseInt(sequence.slice(1), 16));
    }
    return ESCAPES[sequence] ?? sequence;
  });
}
