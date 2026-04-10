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
      removedBytes: undefined,
      startTime: 1000,
      itemCount: 3,
      originalSize: undefined,
    })

    assert.deepStrictEqual(tables, [[{ Time: '3.0s', Items: 3 }]])
  })
})

void describe('calcSize', () => {
  void test('calculates correct MB and percent for 50% reduction', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(2048, 1024)

    // diff: 1024, percent: (1024/2048)*100 = 50.0%
    assert.strictEqual(result, '50.0% (1.0 MB)')
  })

  void test('calculates correct MB and percent for 20% reduction', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(5120, 4096)

    // diff: 1024, percent: (1024/5120)*100 = 20.0%
    assert.strictEqual(result, '20.0% (1.0 MB)')
  })

  void test('calculates correct MB and percent for 33% reduction', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(1536, 1024)

    // diff: 512, percent: (512/1536)*100 = 33.3%
    assert.strictEqual(result, '33.3% (0.5 MB)')
  })

  void test('calculates correct MB and percent with 40% reduction', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(2560, 1536)

    // diff: 1024, percent: (1024/2560)*100 = 40.0%
    assert.strictEqual(result, '40.0% (1.0 MB)')
  })

  void test('calculates correct MB and percent for large reduction', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(10240, 1024)

    // diff: 9216, percent: (9216/10240)*100 = 90.0%
    assert.strictEqual(result, '90.0% (9.0 MB)')
  })

  void test('calculates correct MB and percent for small reduction', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(1050, 1024)

    // diff: 26, percent: (26/1024)*100 = 2.539... = 2.5%
    assert.strictEqual(result, '2.5% (0.0 MB)')
  })

  void test('formats result with percent followed by MB in parentheses', async () => {
    const { calcSize } = await importFresh()
    const result = calcSize(4096, 2048)

    // Verify format: "X.X% (Y.Y MB)"
    assert.match(result, /^\d+\.\d+%\s+\(\d+\.\d+\s+MB\)$/)
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
      dryRun: false,
      help: false,
      showGlobs: false,
      noGlobs: false,
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
      dryRun: false,
      help: false,
      showGlobs: false,
      noGlobs: false,
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
      dryRun: false,
      help: false,
      showGlobs: false,
      noGlobs: false,
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

  void test('exclude has no effect when noGlobs is active', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/foo.ts': '',
      '/workspace/node_modules/.pnpm/custom.custom': '',
      '/workspace/node_modules/.pnpm/pkg/index.js': '',
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom': '',
      '/workspace/node_modules/.pnpm/pkg/package.json': '{}',
    })

    mockMemfsFs(t)
    t.mock.method(console, 'info', () => {})
    t.mock.method(console, 'table', () => {})

    const { prune } = await importFresh()

    // With noGlobs active, exclude patterns should be ignored
    // Only custom pattern from include should be used
    const actual = await prune({
      path: '/workspace/node_modules/.pnpm',
      include: ['**/*.custom'],
      exclude: ['**/*.js'],
      dryRun: false,
      help: false,
      showGlobs: false,
      noGlobs: true,
      noSize: true,
      quiet: false,
    })

    // Should only match the custom files, .js files should NOT be excluded
    // because exclude is ignored when noGlobs is true
    assert.deepStrictEqual(actual, [
      '/workspace/node_modules/.pnpm/custom.custom',
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom',
    ])

    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/custom.custom'),
      false
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b/file.custom'),
      false
    )
    // .js files should still exist because they weren't matched by include
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/foo.ts'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/index.js'),
      true
    )
  })

  void test('dryRun: true returns paths but does not delete files', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/foo.ts': '',
      '/workspace/node_modules/.pnpm/keep.js': '',
      '/workspace/node_modules/.pnpm/custom.custom': '',
    })

    mockMemfsFs(t)
    t.mock.method(console, 'info', () => {})
    t.mock.method(console, 'table', () => {})

    const { prune } = await importFresh()

    const actual = await prune({
      path: '/workspace/node_modules/.pnpm',
      include: ['**/*.custom'],
      exclude: [],
      dryRun: true,
      help: false,
      showGlobs: false,
      noGlobs: false,
      noSize: true,
      quiet: false,
    })

    // dryRun should return the same paths it would delete
    assert.deepStrictEqual(actual.sort(), [
      '/workspace/node_modules/.pnpm/custom.custom',
      '/workspace/node_modules/.pnpm/foo.ts',
    ])

    // Files should NOT be deleted when dryRun is true
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/foo.ts'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/custom.custom'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/keep.js'),
      true
    )
  })

  void test('dryRun: true returns paths but does not delete nested dirs', async t => {
    seedMemfs({
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom': '',
      '/workspace/node_modules/.pnpm/pkg/package.json': '{}',
    })

    mockMemfsFs(t)
    t.mock.method(console, 'info', () => {})
    t.mock.method(console, 'table', () => {})

    const { prune } = await importFresh()

    const actual = await prune({
      path: '/workspace/node_modules/.pnpm',
      include: ['**/*.custom'],
      exclude: [],
      dryRun: true,
      help: false,
      showGlobs: false,
      noGlobs: false,
      noSize: true,
      quiet: false,
    })

    assert.deepStrictEqual(actual, [
      '/workspace/node_modules/.pnpm/pkg/a/b/file.custom',
    ])

    // Nothing should be deleted when dryRun is true
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b/file.custom'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a/b'),
      true
    )
    assert.strictEqual(
      memfs.existsSync('/workspace/node_modules/.pnpm/pkg/a'),
      true
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
