# Changelog

## 0.2.0

### Features

- BREAKING: rename `--globs` to `--showGlobs`
- Semi BREAKING: added few missing globs:
  - `**/*.jsx` js variant
  - `**/*.flow`
  - `**/__typings__/`
  - `**/bower.json`
  - `**/node_modules/.bin/`
  - `**/node_modules/**/man/`
  - `**/**.{test,spec}.{js,mjs}` js variants
  - `**/.zuul.yml`
  - `**/.coveralls.yml`
  - `**/eslint*.{js,mjs}` js variants
  - `**/.eslintignore`
  - `**/.eslintrc*` added the star to widen the net
  - `**/KEYS`,
  - `**/.spmignore`
  - `**/.editorconfig`
  - `**/component.json`
  - `**/*.jison`
- Add `--noGlobs` flag to disable all the default globs, so users can provide
  their own with `--include`
- Add `--dryRun` flag, nothing is deleted and the paths are printed out

### Refactor

- Remove unused `compactPaths` util
- Shorter error message

### Fix

- Calculate size reduction percentage relative to original size

## 0.1.4

- Use a custom walker, about 16% faster

## 0.1.3

- Remove directories which were left empty after pruning
- Make pruned size calculation faster by making it async
- Simplified e2e test runner
  - Add `test-project/prepare_test.sh` setup script
  - Rename `test:run` to `test:e2e`
  - Rename `test:size` to `test:e2e:weight`
  - Rename `test:nuke` to `test:e2e:nuke`
  - Remove `test:setup`

## 0.1.2

- Fix: check path when running the script, not in handleArgs

## 0.1.1

- Better runAsScript handling
