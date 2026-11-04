import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fields of a package manifest these scripts read. */
export interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly bundleDependencies?: readonly string[];
  readonly bundledDependencies?: readonly string[];
}

/** A workspace package under `packages/`. */
export interface WorkspacePackage {
  readonly dir: string;
  readonly manifest: PackageManifest;
}

const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));

/** Every package under `packages/`, in directory order. */
export function listPackages(): WorkspacePackage[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(packagesDir, entry.name);
      const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as PackageManifest;
      return { dir, manifest };
    });
}
