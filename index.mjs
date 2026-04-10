// oxlint-disable prefer-spread
import cp from 'node:child_process'
import fs from 'node:fs/promises'
import { matchesGlob, join, isAbsolute, resolve } from 'node:path'
import { parseArgs, promisify, styleText } from 'node:util'

const exec = promisify(cp.exec)

/**
 * A list of glob patterns for files/dirs to be deleted. The globs are matched
 * with node's `matchesGlob()`. With one special rule: globs which end in `/`
 * are marked as directories.
 *
 * Roughly ordered by popularity (educated guess).
 *
 * Partially based on
 * @see {@link https://github.com/duniul/clean-modules/blob/main/.cleanmodules-default}
 */
const defaultGlobs = [
  // Common ones first
  '**/*.md',
  '**/*.map',
  '**/*.{,m,c}ts',
  '**/*.tsx',
  '**/doc{,s}/',

  // Types
  '**/*tsconfig*.json',
  '**/*.tsbuildinfo',
  '**/flow-typed/',

  // Sensitive
  '**/.env*',

  // Package mangers
  '**/.npm*',
  '**/pnpm-{lock,workspace}.yaml',
  '**/.yarn*',
  '**/yarn.lock',
  '**/bun.lock',
  '**/bunfig.toml',

  // IDE
  '**/.idea/',
  '**/.vscode/',
  '**/.zed/',

  // Docs
  '**/*.markdown',
  '**/example{,s}/',
  '**/website/',
  '**/*.txt',
  '**/AUTHORS',
  '**/contributing',
  '**/CONTRIBUTORS',
  '**/contributors',

  // CI/CD
  '**/.github/',
  '**/.circleci/',
  '**/.vercel',
  '**/now.json',
  '**/.travis.yml',

  // Docker
  '**/Dockerfile*',
  '**/.dockerignore',

  // Tests
  '**/test{,s}/',
  '**/spec{,s}/',
  '**/__{mocks,tests}__/',
  '**/jest.*.{js,ts}',
  '**/vitest.*.ts',
  '**/karma.conf.{js,ts}',
  '**/wallaby.conf.{js,ts}',
  '**/wallaby.{js,ts}',
  '**/playwright.config.{js,ts}',
  '**/.mocharc*',

  // Build/bundle config
  '**/{rollup,rolldown,vite}.config.{js,ts,mjs}',
  '**/webpack.config.{js,mjs,cjs,ts}',
  '**/babel.config.{js,mjs,cjs,json}',
  '**/parcel.config.{js,ts,json}',
  '**/rspack.config.{js,mjs,cjs,ts}',
  '**/.babelrc*',
  '**/turbo.json',
  '**/.browserslist*',
  '**/metro.config.{js,json}',
  '**/{G,g}runtfile.{js,ts}',
  '**/{G,g}ulpfile.{js,ts}',
  '**/{M,m}akefile',
  '**/gemfile',

  // Images
  '**/*.jp{,e}g',
  '**/*.svg',
  '**/*.gif',
  '**/*.png',

  // Linters and formatters
  '**/eslint*.{json,jsonc,ts}',
  '**/.eslintrc',
  '**/prettier.config*',
  '**/.prettier*',
  '**/.ox{lint,fmt}rc.json{,c}',
  '**/ox{lint,fmt}*.{json,jsonc,ts}',
  '**/biome.json{,c}',
  '**/.dprint.json{,c}',
  '**/.jshintrc',
  '**/.lint',
  '**/tslint.json',

  // Git
  '**/.git/',
  '**/.gitattributes',
  '**/.gitmodules',

  // Code coverage
  '**/.nyc_output/',
  '**/.nycrc*',
  '**/.codecov.y{,a}ml',
  '**/coverage/',

  // Licenses
  '**/LICEN{C,S}E*',
  '**/licen{s,c}e*',
  '**/{CHANGELOG,changelog}',
  '**/README',
  '**/NOTICE',
  '**/OSSMETADATA',

  // Compiled
  '**/*.h',
  '**/*.c',
  '**/*.hpp',
  '**/*.cpp',
  '**/*.o',
  '**/*.mk',

  // Compressed
  '**/*.{,g}zip',
  '**/*.{r,t}ar',
  '**/*.{,t}gz',
  '**/*.7z',

  // CoffeeScript
  '**/*.coffee',

  // Misc
  '**/.jscpd',
  '**/*.jst',
  '**/*.log',
  '**/*.mkd',
  '**/*.orig',
  '**/*.patch',
  '**/*.pdb',
  '**/*.rej',
  '**/*.sln',
  '**/*.swp',
  '**/*.tlog',
  '**/.dir-locals.el',
  '**/.DS_Store',
  '**/.iml',
  '**/.jamignore',
  '**/binding.gyp',
  '**/cakefile',
  '**/node-gyp',
  '**/pom.xml',
  '**/thumbs.db',
]

/**
 * Prints out instructions
 * @returns {void}
 */
function usage() {
  const usageText = `
  Removes non-prod files from node_modules, config files, readmes, types, etc.

  Examples:
    Basic usage:
    $ prod-files node_modules/.pnpm
    Short:
    $ pf node_modules/.pnpm

    Since we’re just raw-dogging parseArgs, the short args don’t support inline
    arguments, so don't use equals signs:
    $ pf -i "**/foo" -e "**/*tsconfig*.json" node_modules/.pnpm

    Also with short-hand args the space between the key and the value can be
    omitted:
    $ pf -i"**/foo" node_modules/.pnpm

  Usage:
    prod-files [flags] path
    pf [flags] path

  Arguments:
    path          Relative or absolute path to node_modules directory:
                  - pnpm: 'node_modules/.pnpm'
                  - npm:  'node_modules'
                  - yarn: 'node_modules' or 'node_modules/.store'

  Flags:
    -i, --include Glob patterns of extra files to be removed. Uses node's
                  path.matchesGlob(), with one exception: patterns ending with
                  slash '**/foo/' are marked as directories.

    -e, --exclude Exclude existing glob patterns if the script is too
                  aggressive. Must be exact match.

    -h, --help    Prints out the help.

    -g, --globs   Prints out the default globs.

    -n, --noSize  Skips the size calculation.

    -q, --quiet   Quiet output, suppresses stdout.
`

  log.log(usageText)
}

/**
 * Logs error, and usage if defined, then exits with 1
 * @param {string} [message]
 * @param {unknown} [error]
 * @param {boolean} [withUsage]
 * @returns {void}
 */
function bail(message, error, withUsage = false) {
  if (error) {
    log.error(error)
    process.exit(1)
  }
  log.info(message)
  if (withUsage) usage()
  process.exit(0)
}

/**
 * @typedef {Object} Logger
 * @property {typeof console.error} error - Logs error messages in red
 * @property {typeof console.info} info - Logs information messages in blue
 * @property {typeof console.info} log - Logs with no color
 * @property {typeof console.log} success - Logs success messages in green
 * @property {typeof console.table} table - Logs as table
 */

// Quiet mode
let quiet = /** @type {boolean} */ (false)

/**
 * @param {import('node:util').InspectColor} color
 * @param {any[]} args
 * @returns
 */
const style = (color, args) => args.map(a => styleText(color, String(a)))

/**
 * A utility for styled console logs
 * @type {Logger}
 */
export const log = {
  error: (...a) =>
    quiet ? undefined : console.error.apply(console, style('red', a)),
  info: (...a) =>
    quiet ? undefined : console.info.apply(console, style('blue', a)),
  log: (...a) => (quiet ? undefined : console.log.apply(console, a)),
  success: (...a) =>
    quiet ? undefined : console.log.apply(console, style('green', a)),
  table: (...a) => (quiet ? undefined : console.table.apply(console, a)),
}

/**
 * Get disk usage via du (512-byte blocks)
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
async function getSize(dirPath) {
  const { stdout, stderr } = await exec(`LC_ALL=C du -s ${dirPath}`)
  if (stderr.length > 0) bail(stderr)
  const size = stdout.split('\t')[0]
  return size ? Number.parseInt(size, 10) : 0
}

/**
 * Sums disk usage of a path using lstat blocks (512-byte blocks, same as du)
 * @param {string} path
 * @returns {Promise<number>} Total in 512-byte blocks
 */
async function treeSize(path) {
  /** @type {import('node:fs').Stats} */
  let stat
  try {
    stat = await fs.lstat(path)
  } catch {
    // Entry disappeared (concurrent pruning), count as 0
    return 0
  }
  if (!stat.isDirectory()) return stat.blocks
  const names = await fs.readdir(path).catch(() => [])
  const sizes = await Promise.all(names.map(n => treeSize(join(path, n))))
  let total = 0
  for (const s of sizes) total += s
  return total
}

/**
 * @param {number} originalSize
 * @param {number} prunedSize
 */
function calcSize(originalSize, prunedSize) {
  const diff = originalSize - prunedSize
  const diffMb = `${(diff / 1024).toFixed(1)} MB`
  const diffPercent = `${((diff / prunedSize) * 100).toFixed(1)}%`

  return `${diffPercent} (${diffMb})`
}

/**
 * Prints a nice diff table
 * @param {object} opts
 * @param {number | undefined} opts.removedBytes
 * @param {number} opts.startTime
 * @param {number} opts.itemCount
 * @param {number | undefined} opts.originalSize
 */
export function printDiff({
  removedBytes,
  startTime,
  itemCount,
  originalSize,
}) {
  log.table([
    {
      ...(originalSize &&
        removedBytes && {
          Pruned: calcSize(originalSize, originalSize - removedBytes),
        }),
      Time: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      Items: itemCount,
    },
  ])
}

/**
 * @typedef Args
 * @type {object}
 * @property {string} [path] - Path to node_modules
 * @property {string[]} include - New glob pattern
 * @property {string[]} exclude - Existing glob pattern
 * @property {boolean} help - Prints help
 * @property {boolean} noSize - Don't show size savings
 * @property {boolean} globs - Prints globs
 * @property {boolean} quiet - Suppress console.log output
 */

/**
 * Parse the command-line arguments into an object
 * @returns {Args}
 */

function handleArgs() {
  try {
    const {
      values,
      positionals: [path],
    } = parseArgs({
      allowPositionals: true,
      options: {
        include: { type: 'string', short: 'i', default: [], multiple: true },
        exclude: { type: 'string', short: 'e', default: [], multiple: true },
        help: { type: 'boolean', short: 'h', default: false },
        globs: { type: 'boolean', short: 'g', default: false },
        noSize: { type: 'boolean', short: 'n', default: false },
        quiet: { type: 'boolean', short: 'q', default: false },
      },
    })

    return { ...values, path }
  } catch (err) {
    throw bail(undefined, err, true)
  }
}

/**
 * Check if the given path exists on disc
 * @param {string|undefined} nodeModulesPath
 * @returns {Promise<string>}
 */
export async function validateNodeModulesPath(nodeModulesPath) {
  if (!nodeModulesPath) throw bail(undefined, 'path arg is required', true)

  const absolutePath = isAbsolute(nodeModulesPath)
    ? nodeModulesPath
    : resolve(process.cwd(), nodeModulesPath)

  try {
    await fs.access(absolutePath)
    return absolutePath
  } catch (err) {
    throw bail(undefined, err)
  }
}

/**
 * `file.matchesGlob()` does not match dotfiles, this util replaces leading dots
 * with an underscore
 * @param {string} pathOrPattern
 */
function escapeLeadingDots(pathOrPattern) {
  return pathOrPattern.replace(/(^|\/)\./g, '$1_')
}

/**
 * @typedef {object} CompiledSet
 * @property {Set<string>} exact
 * @property {string[]} prefix
 * @property {string[]} ext
 * @property {RegExp[]} pats
 * @property {string[]} globs
 */

/**
 * @typedef {object} CompiledGlobs
 * @property {CompiledSet} any
 * @property {CompiledSet} dir
 */

/**
 * @returns {CompiledSet}
 */
function makeSet() {
  return {
    exact: new Set(),
    prefix: [],
    ext: [],
    pats: [],
    globs: [],
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasGlobChars(value) {
  return (
    value.includes('*') ||
    value.includes('?') ||
    value.includes('[') ||
    value.includes(']') ||
    value.includes('{') ||
    value.includes('}')
  )
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
}

/**
 * Splits a brace expression on top-level commas while preserving nested groups
 * @param {string} value - Brace contents without the outer `{}` characters
 * @returns {string[]} The individual brace options in their original order
 */
function splitBraceOptions(value) {
  /** @type {string[]} */
  const options = []
  let current = ''
  let depth = 0

  for (const char of value) {
    // Only split on commas that are not nested inside another brace pair
    if (char === ',' && depth === 0) {
      options.push(current)
      current = ''
      continue
    }

    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    current += char
  }

  options.push(current)

  return options
}

/**
 * Converts a basename-style glob fragment into a regular expression source.
 * Supports `*`, `?`, and nested brace expansions such as `{js,ts}`.
 * @param {string} glob - The glob fragment to translate
 * @returns {string} A regex source string that preserves path-segment boundaries
 */
function globFragmentToRegExpSource(glob) {
  let source = ''

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === undefined) continue

    if (char === '*') {
      // `*` matches any characters except path separators
      source += '[^/]*'
      continue
    }

    if (char === '?') {
      source += '[^/]'
      continue
    }

    if (char === '{') {
      let depth = 1
      let endIndex = index + 1

      // Find the matching closing brace so nested brace groups stay intact
      while (endIndex < glob.length && depth > 0) {
        if (glob[endIndex] === '{') depth += 1
        if (glob[endIndex] === '}') depth -= 1
        endIndex += 1
      }

      if (depth > 0) {
        source += '\\{'
        continue
      }

      const braceContents = glob.slice(index + 1, endIndex - 1)
      const options = splitBraceOptions(braceContents)
      const optionSource = options
        .map(option => globFragmentToRegExpSource(option))
        .join('|')

      source += `(?:${optionSource})`
      index = endIndex - 1
      continue
    }

    source += escapeRegExp(char)
  }

  return source
}

/**
 * Compiles a basename glob into an anchored regular expression
 * @param {string} basenameGlob - A glob that is expected to match a single path segment
 * @returns {RegExp} A regular expression that must match the whole basename
 */
function basenameGlobToRegExp(basenameGlob) {
  return new RegExp(`^${globFragmentToRegExpSource(basenameGlob)}$`)
}

/**
 * Fast paths for globs: adds a glob to the most efficient matcher bucket
 * available
 * @param {string} glob - The glob pattern to classify
 * @param {CompiledSet} set - The compiled matcher set being populated
 */
function addGlob(glob, set) {
  if (glob.startsWith('**/*.')) {
    const ext = glob.slice('**/*.'.length)
    if (ext && !ext.includes('/') && !hasGlobChars(ext)) {
      // Fast path for recursive extension globs like `**/*.log`
      set.ext.push(`.${ext}`)
      return
    }
  }

  if (glob.startsWith('**/') && glob.endsWith('*')) {
    const prefix = glob.slice('**/'.length, -1)
    if (prefix && !prefix.includes('/') && !hasGlobChars(prefix)) {
      // Fast path for basename prefix globs like `**/npm-debug*`
      set.prefix.push(prefix)
      return
    }
  }

  if (glob.startsWith('**/')) {
    const base = glob.slice('**/'.length)
    if (base && !base.includes('/')) {
      if (hasGlobChars(base)) set.pats.push(basenameGlobToRegExp(base))
      else set.exact.add(base)
      return
    }
  }

  // Anything more complex falls back to full path glob matching
  set.globs.push(escapeLeadingDots(glob))
}

/**
 * Compiles raw glob strings into optimized matcher sets for files and
 * directories.
 * @param {string[]} globs - User-provided glob patterns
 * @returns {CompiledGlobs} The compiled matcher structure used during scanning
 */
export function compileGlobs(globs) {
  /** @type {CompiledGlobs} */
  const compiledGlobs = { any: makeSet(), dir: makeSet() }

  for (const glob of globs) {
    const isDir = glob.endsWith('/')
    const set = isDir ? compiledGlobs.dir : compiledGlobs.any
    addGlob(isDir ? glob.slice(0, -1) : glob, set)

    if (isDir && set.globs.length > 0) {
      const last = set.globs.pop()
      // Directory globs keep their trailing slash so they cannot match files
      if (last !== undefined) set.globs.push(`${last}/`)
    }
  }

  return compiledGlobs
}

const defaultCompiledGlobs = compileGlobs(defaultGlobs)

/** @typedef {import('node:fs').Dirent} Dirent */

/**
 * Checks whether a basename matches any of the precompiled fast-match buckets
 * @param {string} name - The basename to test
 * @param {CompiledSet} set - The compiled matcher set to test against
 * @returns {boolean} `true` when the basename matches any exact, prefix, extension, or regex rule
 */
function matchesSet(name, set) {
  // Keep the cheapest checks first because this runs for every scanned entry
  if (set.exact.has(name)) return true
  for (const prefix of set.prefix) if (name.startsWith(prefix)) return true
  for (const ext of set.ext) if (name.endsWith(ext)) return true
  for (const pat of set.pats) if (pat.test(name)) return true

  return false
}

/**
 * Finds file system entries that match the compiled junk rules
 * @param {Dirent[]} files - Directory entries collected during traversal
 * @param {CompiledGlobs} [compiledGlobs=defaultCompiledGlobs] - Precompiled glob matchers to apply
 * @returns {string[]} Full paths for entries considered junk
 */
export function findJunkFiles(files, compiledGlobs = defaultCompiledGlobs) {
  /** @type {string[]} */
  const junkFiles = []
  const hasAnyGlobs = compiledGlobs.any.globs.length > 0
  const hasDirGlobs = compiledGlobs.dir.globs.length > 0

  for (const file of files) {
    const { name, parentPath } = file
    const isDir = file.isDirectory()

    // Basename checks are cheaper than full path glob checks, so try them first
    if (
      matchesSet(name, compiledGlobs.any) ||
      (isDir && matchesSet(name, compiledGlobs.dir))
    ) {
      junkFiles.push(join(parentPath, name))
      continue
    }

    if (!hasAnyGlobs && !(isDir && hasDirGlobs)) continue

    const path = join(parentPath, name)
    const escapedPath = escapeLeadingDots(isDir ? `${path}/` : path)
    const match =
      compiledGlobs.any.globs.some(glob => matchesGlob(escapedPath, glob)) ||
      (isDir &&
        compiledGlobs.dir.globs.some(glob => matchesGlob(escapedPath, glob)))

    // Don't add directories twice when both basename and path globs could match
    if (match) junkFiles.push(path)
  }

  return junkFiles
}

/**
 * @typedef {object} WalkResult
 * @property {string[]} removed - Compacted list of removed paths
 * @property {number} removedBlocks - Removed disk usage in 512-byte blocks
 */

/**
 * Parallel walker that finds junk, removes it, and cleans empty dirs in one
 * pass. Skips recursing into junk directories (implicit path compacting) and
 * removes empty ancestors bottom-up as the recursion unwinds.
 * @param {string} rootDir - The directory to walk
 * @param {CompiledGlobs} compiledGlobs - Precompiled glob matchers
 * @param {boolean} trackSize - Whether to collect byte sizes of removed items
 * @returns {Promise<WalkResult>}
 */
async function walkAndPrune(rootDir, compiledGlobs, trackSize) {
  /** @type {string[]} */
  const removed = []
  let removedBlocks = 0
  const hasAnyGlobs = compiledGlobs.any.globs.length > 0
  const hasDirGlobs = compiledGlobs.dir.globs.length > 0

  /**
   * Walks a directory in parallel, removes junk, and reports whether the
   * directory still has content so the caller can clean up empty parents
   * @param {string} dir
   * @returns {Promise<boolean>} true when the directory still has content
   */
  async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    /** @type {string[]} */
    const junkPaths = []
    /** @type {string[]} */
    const keptDirPaths = []
    let keptFiles = 0

    for (const entry of entries) {
      const { name } = entry
      const isDir = entry.isDirectory()
      const path = join(dir, name)

      // Basename checks are cheapest, try them first
      if (
        matchesSet(name, compiledGlobs.any) ||
        (isDir && matchesSet(name, compiledGlobs.dir))
      ) {
        junkPaths.push(path)
        continue
      }

      // Full path glob checks only when compiled globs exist
      if (hasAnyGlobs || (isDir && hasDirGlobs)) {
        const escapedPath = escapeLeadingDots(isDir ? `${path}/` : path)
        if (
          compiledGlobs.any.globs.some(g => matchesGlob(escapedPath, g)) ||
          (isDir &&
            compiledGlobs.dir.globs.some(g => matchesGlob(escapedPath, g)))
        ) {
          junkPaths.push(path)
          continue
        }
      }

      if (isDir) keptDirPaths.push(path)
      else keptFiles += 1
    }

    // Collect removed paths before awaiting (no junk dir recursion = compacting)
    for (const p of junkPaths) removed.push(p)

    // Size (when tracking), remove junk, and recurse kept subdirs in parallel
    const [junkSizes, walkResults] = await Promise.all([
      Promise.all(
        junkPaths.map(async p => {
          const size = trackSize ? await treeSize(p) : 0
          await fs.rm(p, { recursive: true, force: true })
          return size
        })
      ),
      Promise.all(keptDirPaths.map(walkDir)),
    ])

    for (const s of junkSizes) removedBlocks += s

    // Subdirs that became empty after pruning their contents
    const emptyDirs = keptDirPaths.filter((_, i) => !walkResults[i])
    if (emptyDirs.length > 0) {
      await Promise.all(emptyDirs.map(d => fs.rmdir(d)))
    }

    return keptFiles + keptDirPaths.length - emptyDirs.length > 0
  }

  await walkDir(rootDir)
  return { removed, removedBlocks }
}

/**
 * @typedef {Args & { path: string }} ArgsWithPath
 */

/**
 * Removes unneeded files from node_modules
 * @param {ArgsWithPath} opts
 */
export async function prune(opts) {
  const startTime = Date.now()
  log.info('Pruning:', opts.path)

  // Fire early so du runs concurrently with the walk
  const sizePromise = opts.noSize ? undefined : getSize(opts.path)
  const excludedGlobs = new Set(opts.exclude)
  const activeGlobs = [...defaultGlobs, ...opts.include].filter(
    glob => !excludedGlobs.has(glob)
  )
  const compiledGlobs = compileGlobs(activeGlobs)

  /** @type {WalkResult} */
  let result
  try {
    result = await walkAndPrune(opts.path, compiledGlobs, !opts.noSize)
  } catch (err) {
    throw bail(undefined, err)
  }

  printDiff({
    itemCount: result.removed.length,
    removedBytes: opts.noSize ? undefined : result.removedBlocks,
    originalSize: sizePromise ? await sizePromise : undefined,
    startTime,
  })

  return result.removed
}

const entry = process.argv[1]
const runAsScript =
  entry && import.meta.filename.endsWith(entry.replace(process.cwd(), ''))

if (runAsScript) {
  const args = handleArgs()

  quiet = args.quiet

  if (args.help) {
    usage()
    process.exit(0)
  }

  if (args.globs) {
    log.log(JSON.stringify(defaultGlobs, null, 2))
    process.exit(0)
  }

  // From this point forward we should have a path
  if (!args.path) {
    throw bail(undefined, 'Path not defined. Usage: prod-files <path>')
  }

  const argsWithPath = /** @type {ArgsWithPath} */ (args)

  await validateNodeModulesPath(argsWithPath.path)
  await prune(argsWithPath)
}
