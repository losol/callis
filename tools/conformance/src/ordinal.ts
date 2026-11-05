/**
 * Orders strings by UTF-16 code unit. Unlike `localeCompare`, the order is the same on every machine
 * and locale, so generated files do not depend on where they were generated.
 */
export function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
