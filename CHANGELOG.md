# Changelog

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
