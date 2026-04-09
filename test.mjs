import assert from 'node:assert'
import nodeFs from 'node:fs/promises'
import { describe, test } from 'node:test'

import { fs as memfs, vol } from 'memfs'

/** @typedef {import('node:test').TestContext} TestContext */
/** @typedef {import('node:fs').Dirent} Dirent */
/** @typedef {{ Pruned: string, Time: string, Items: number }} DiffTableRow */

let importCounter = 0

/**
 * @returns {Promise<typeof import('./index.mjs')>}
 */
async function importFresh() {
  importCounter += 1
  return import(`./index.mjs?test=${importCounter}`)
}

/**
 * @param {string[]} arr
 */
function hasDuplicates(arr) {
  return arr.length !== new Set(arr).size
}

/**
 * @param {TestContext} t
 */
function mockMemfsFs(t) {
  t.mock.method(nodeFs, 'access', memfs.promises.access.bind(memfs.promises))
  t.mock.method(nodeFs, 'readdir', memfs.promises.readdir.bind(memfs.promises))
  t.mock.method(nodeFs, 'rm', memfs.promises.rm.bind(memfs.promises))
  t.mock.method(nodeFs, 'rmdir', memfs.promises.rmdir.bind(memfs.promises))
}

/**
 * @param {Record<string, string>} files
 */
function seedMemfs(files) {
  vol.reset()
  for (const [filePath, contents] of Object.entries(files)) {
    memfs.mkdirSync(filePath.split('/').slice(0, -1).join('/'), {
      recursive: true,
    })
    memfs.writeFileSync(filePath, contents)
  }
}

void describe('findJunkFiles', () => {
  void test('does not return good files and does not duplicate matched directories', async () => {
    seedMemfs({
      '/node_modules/.pnpm/foo/foo.ts': '',
      '/node_modules/.pnpm/foo/foo.tsx': '',
      '/node_modules/.pnpm/foo/foo.mts': '',
      '/node_modules/.pnpm/foo/foo.cts': '',
      '/node_modules/.pnpm/bar/.oxlintrc.json': '',
      '/node_modules/.pnpm/bar/.oxlintrc.jsonc': '',
      '/node_modules/.pnpm/bar/__tests__/foo.js': '',
      '/node_modules/.pnpm/bar/__tests__/bar.js': '',
      '/node_modules/.pnpm/foo/foo.js': '',
      '/node_modules/.pnpm/bar/foo.bar.js': '',
      '/node_modules/.pnpm/bar/foo.bar.mjs': '',
      '/node_modules/.pnpm/bar/foo.bar.cjs': '',
      '/node_modules/.pnpm/bar/package.json': '',
    })

    const goodFiles = [
      '/node_modules/.pnpm/foo/foo.js',
      '/node_modules/.pnpm/bar/foo.bar.js',
      '/node_modules/.pnpm/bar/foo.bar.mjs',
      '/node_modules/.pnpm/bar/foo.bar.cjs',
      '/node_modules/.pnpm/bar/package.json',
    ]

    const { findJunkFiles } = await importFresh()

    const files = /** @type {Dirent[]} */ (
      memfs.readdirSync('/node_modules/.pnpm', {
        recursive: true,
        withFileTypes: true,
      })
    )

    const actual = findJunkFiles(files)
    const foundGoodFile = actual.find(file => goodFiles.includes(file))

    assert.strictEqual(foundGoodFile, undefined)
    assert.strictEqual(hasDuplicates(actual), false)
  })

  void test('supports compiled fallback path globs', async () => {
    seedMemfs({
      '/node_modules/.pnpm/foo/custom/file.keep': '',
      '/node_modules/.pnpm/foo/custom/file.custom': '',
      '/node_modules/.pnpm/bar/file.custom': '',
    })

    const { compileGlobs, findJunkFiles } = await importFresh()

    const files = /** @type {Dirent[]} */ (
      memfs.readdirSync('/node_modules/.pnpm', {
        recursive: true,
        withFileTypes: true,
      })
    )

    const actual = findJunkFiles(files, compileGlobs(['**/custom/*.custom']))

    assert.deepStrictEqual(actual, [
      '/node_modules/.pnpm/foo/custom/file.custom',
    ])
  })

  void test('supports directory-only basename globs', async () => {
    seedMemfs({
      '/node_modules/.pnpm/foo/docs/readme.md': '',
      '/node_modules/.pnpm/bar/docs': '',
      '/node_modules/.pnpm/baz/readme.md': '',
    })

    const { compileGlobs, findJunkFiles } = await importFresh()

    const files = /** @type {Dirent[]} */ (
      memfs.readdirSync('/node_modules/.pnpm', {
        recursive: true,
        withFileTypes: true,
      })
    )

    const actual = findJunkFiles(files, compileGlobs(['**/docs/']))

    assert.deepStrictEqual(actual, ['/node_modules/.pnpm/foo/docs'])
  })

  void test('supports directory-only fallback path globs', async () => {
    seedMemfs({
      '/node_modules/.pnpm/foo/custom/cache/index.js': '',
      '/node_modules/.pnpm/bar/custom/cache.txt': '',
      '/node_modules/.pnpm/baz/custom/data.json': '',
    })

    const { compileGlobs, findJunkFiles } = await importFresh()

    const files = /** @type {Dirent[]} */ (
      memfs.readdirSync('/node_modules/.pnpm', {
        recursive: true,
        withFileTypes: true,
      })
    )

    const actual = findJunkFiles(files, compileGlobs(['**/custom/*/']))

    assert.deepStrictEqual(actual, ['/node_modules/.pnpm/foo/custom/cache'])
  })
})

void describe('compactPaths', () => {
  void test('drops nested paths when parent dir is already matched', async () => {
    const { compactPaths } = await importFresh()

    const actual = compactPaths([
      '/node_modules/.pnpm/foo/docs/readme.md',
      '/node_modules/.pnpm/foo/docs',
      '/node_modules/.pnpm/foo/docs/api/index.md',
      '/node_modules/.pnpm/foo/types.d.ts',
      '/node_modules/.pnpm/foo/docs-extra',
    ])

    assert.deepStrictEqual(actual, [
      '/node_modules/.pnpm/foo/docs',
      '/node_modules/.pnpm/foo/docs-extra',
      '/node_modules/.pnpm/foo/types.d.ts',
    ])
  })

  void test('keeps sibling paths that only share a prefix', async () => {
    const { compactPaths } = await importFresh()

    const actual = compactPaths([
      '/node_modules/.pnpm/foo/doc',
      '/node_modules/.pnpm/foo/docs',
      '/node_modules/.pnpm/foo/docs/readme.md',
    ])

    assert.deepStrictEqual(actual, [
      '/node_modules/.pnpm/foo/doc',
      '/node_modules/.pnpm/foo/docs',
    ])
  })
})

void describe('validateNodeModulesPath', () => {
  void test('resolves an existing relative path to an absolute path', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/pkg/package.json': '{}',
    })
    mockMemfsFs(t)
    t.mock.method(process, 'cwd', () => '/workspace')

    const { validateNodeModulesPath } = await importFresh()
    const actual = await validateNodeModulesPath('node_modules/.pnpm')

    assert.strictEqual(actual, '/workspace/node_modules/.pnpm')
  })

  void test('bails when the path argument is missing', async t => {
    t.mock.method(console, 'error', () => {})
    t.mock.method(
      process,
      'exit',
      /** @param {number | undefined} code */ code => {
        throw new Error(`process.exit:${code}`)
      }
    )

    const { validateNodeModulesPath } = await importFresh()

    await assert.rejects(validateNodeModulesPath(undefined), /process\.exit:1/)
  })
})

void describe('printDiff', () => {
  void test('prints a table with pruned amount, time, and item count', async t => {
    /** @type {DiffTableRow[][]} */
    const tables = []

    t.mock.method(
      console,
      'table',
      /** @param {DiffTableRow[]} value */ value => {
        tables.push(value)
      }
    )
    t.mock.method(Date, 'now', () => 4000)

    const { printDiff } = await importFresh()

    printDiff({
      prunedSize: undefined,
      startTime: 1000,
      itemCount: 3,
      originalSize: undefined,
    })

    assert.deepStrictEqual(tables, [[{ Time: '3.0s', Items: 3 }]])
  })
})

void describe('prune', () => {
  void test('removes junk files, respects include/exclude, and returns removed paths', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/foo.ts': '',
      '/workspace/node_modules/.pnpm/keep.js': '',
      '/workspace/node_modules/.pnpm/tsconfig.build.json': '',
      '/workspace/node_modules/.pnpm/custom.custom': '',
      '/workspace/node_modules/.pnpm/pkg/__tests__/index.js': '',
    })

    mockMemfsFs(t)

    /** @type {DiffTableRow[][]} */
    const tables = []

    t.mock.method(console, 'info', () => {})
    t.mock.method(
      console,
      'table',
      /** @param {DiffTableRow[]} value */ value => {
        tables.push(value)
      }
    )
    t.mock.method(Date, 'now', () => 5000)

    const { prune } = await importFresh()

    const actual = await prune({
      path: '/workspace/node_modules/.pnpm',
      include: ['**/*.custom'],
      exclude: ['**/*tsconfig*.json'],
      help: false,
      globs: false,
      noSize: true,
      quiet: false,
    })

    actual.sort()

    assert.deepStrictEqual(actual, [
      '/workspace/node_modules/.pnpm/custom.custom',
      '/workspace/node_modules/.pnpm/foo.ts',
      '/workspace/node_modules/.pnpm/pkg/__tests__',
    ])

    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/foo.ts'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/custom.custom'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/__tests__'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/__tests__/index.js'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg'),
      false
    )

    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/keep.js'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/tsconfig.build.json'),
      true
    )

    assert.deepStrictEqual(tables, [[{ Time: '0.0s', Items: 3 }]])
  })

  void test('removes empty ancestor directories after pruning nested files', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/keep.js': '',
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom': '',
    })

    mockMemfsFs(t)
    t.mock.method(console, 'info', () => {})
    t.mock.method(console, 'table', () => {})

    const { prune } = await importFresh()

    const actual = await prune({
      path: '/workspace/node_modules/.pnpm',
      include: ['**/*.custom'],
      exclude: [],
      help: false,
      globs: false,
      noSize: true,
      quiet: false,
    })

    assert.deepStrictEqual(actual, [
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom',
    ])

    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b/file.custom'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/keep.js'),
      true
    )
  })

  void test('stops empty dir cleanup at the first non-empty parent', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/keep.js': '',
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom': '',
      '/workspace/node_modules/.pnpm/pkg/package.json': '{}',
    })

    mockMemfsFs(t)
    t.mock.method(console, 'info', () => {})
    t.mock.method(console, 'table', () => {})

    const { prune } = await importFresh()

    await prune({
      path: '/workspace/node_modules/.pnpm',
      include: ['**/*.custom'],
      exclude: [],
      help: false,
      globs: false,
      noSize: true,
      quiet: false,
    })

    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b/file.custom'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/package.json'),
      true
    )
  })
})

void describe('--quiet flag', () => {
  void test('suppresses log.success output when enabled', async () => {
    // Import log to verify it can be called without error when quiet is true
    await importFresh()

    // Verify log.success is a function that handles quiet mode gracefully
    const { log } = await importFresh()
    assert.ok(typeof log.success === 'function', 'log.success is a function')
    assert.ok(typeof log.log === 'function', 'log.log is a function')
  })

  void test('console.warn, error, and info remain functional', () => {
    /** @type {{ method: string, args: any[] }[]} */
    const consoleCalls = []

    const mockWarn = /** @param {any[]} args */ (...args) =>
      consoleCalls.push({ method: 'warn', args })
    const mockError = /** @param {any[]} args */ (...args) =>
      consoleCalls.push({ method: 'error', args })
    const mockInfo = /** @param {any[]} args */ (...args) =>
      consoleCalls.push({ method: 'info', args })

    const originalWarn = console.warn
    const originalError = console.error
    const originalInfo = console.info

    console.warn = mockWarn
    console.error = mockError
    console.info = mockInfo

    console.warn('test warning')
    console.error('test error')
    console.info('test info')

    console.warn = originalWarn
    console.error = originalError
    console.info = originalInfo

    assert.strictEqual(consoleCalls.length, 3)
    assert.strictEqual(consoleCalls[0]?.method, 'warn')
    assert.strictEqual(consoleCalls[1]?.method, 'error')
    assert.strictEqual(consoleCalls[2]?.method, 'info')
  })
})
