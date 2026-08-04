#!/usr/bin/env node
// Enforces the package dependency-direction rules from
// docs/ARCHITECTURE.md §3 as part of `pnpm lint`.
//
// Why this exists instead of an ESLint plugin: eslint-plugin-boundaries
// (the standard tool for this) could not be made to resolve this repo's
// internal `@web3-hunter/*` workspace packages — which point at TypeScript
// source via package.json "exports" rather than a built dist/ — to their
// element type, so it silently allowed every cross-package import in
// testing. Rather than depend on an integration that couldn't be verified
// to actually work, this script checks the one thing that matters
// mechanically: every `@web3-hunter/*` import inside a package's source
// must correspond to a dependency that package's own package.json
// declares. Since every package.json in this repo already encodes exactly
// the allowed dependencies from ARCHITECTURE.md §3, this is a complete,
// simple, and easily-verified enforcement of the same rule.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const WORKSPACE_GLOBS = [join(rootDir, "apps"), join(rootDir, "packages")];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "migrations"]);

const IMPORT_PATTERN = /(?:from\s+|require\()\s*["'](@web3-hunter\/[a-z0-9-]+)["']/g;

/** @returns {{ name: string, dir: string, allowed: Set<string> }[]} */
function loadWorkspacePackages() {
  const packages = [];

  for (const workspaceDir of WORKSPACE_GLOBS) {
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const packageDir = join(workspaceDir, entry.name);
      const packageJsonPath = join(packageDir, "package.json");

      let manifest;
      try {
        manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      } catch {
        continue;
      }

      const allowed = new Set(
        Object.keys(manifest.dependencies ?? {}).filter((dep) => dep.startsWith("@web3-hunter/")),
      );

      packages.push({ name: manifest.name, dir: packageDir, allowed });
    }
  }

  return packages;
}

/** @returns {string[]} absolute file paths */
function findSourceFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findSourceFiles(entryPath));
      continue;
    }

    if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      files.push(entryPath);
    }
  }

  return files;
}

function main() {
  const packages = loadWorkspacePackages();
  const violations = [];

  for (const pkg of packages) {
    for (const filePath of findSourceFiles(pkg.dir)) {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const importedPackage = match[1];

        if (importedPackage === pkg.name) continue;
        if (pkg.allowed.has(importedPackage)) continue;

        const upToMatch = content.slice(0, match.index);
        const line = upToMatch.split("\n").length;

        violations.push({
          file: relative(rootDir, filePath),
          line,
          from: pkg.name,
          to: importedPackage,
          source: lines[line - 1]?.trim(),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("Architectural boundary violations found (see docs/ARCHITECTURE.md §3):\n");

    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    "${v.from}" is not allowed to depend on "${v.to}"`);
      console.error(`    ${v.source}\n`);
    }

    console.error(
      `${violations.length} violation(s). If this dependency is architecturally correct, ` +
        "the fix is to update docs/ARCHITECTURE.md §3 and the importing package's " +
        "package.json dependencies together — not to silence this check.",
    );
    // Not process.exit(1): that can truncate buffered stderr writes when
    // piped (e.g. into a log file or CI runner). Setting exitCode and
    // letting the process end naturally guarantees the output above is
    // fully flushed first.
    process.exitCode = 1;
    return;
  }

  console.log("No architectural boundary violations found.");
}

main();
