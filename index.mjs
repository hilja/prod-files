import childProcess from 'node:child_process'
import fs from 'node:fs/promises'
import { matchesGlob, join, isAbsolute, resolve } from 'node:path'
import { parseArgs, styleText } from 'node:util'

/**
 * A list of glob patterns for files/dirs to be deleted. The globs are matched
 * with node's `matchesGlob()`. With one special rule: globs which end in `/`
 * are marked as directories.
 *
 * Ordered by popularity (educated guess).
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

  // TypeScript
  '**/*tsconfig*.json',
  '**/*.tsbuildinfo',

  // Package mangers
  '**/.npm*',
  '**/pnpm-*.y{,a}ml',
  '**/.yarn*',
  '**/yarn.lock',
  '**/bun.lock',

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

  // Tests
  '**/test{,s}/',
  '**/spec{,s}/',
  '**/__{mocks,tests}__/',
  '**/jest.*.{js,ts}',
  '**/vitest.*.ts',
  '**/karma.conf.{js,ts}',
  '**/wallaby.conf.{js,ts}',
  '**/wallaby.{js,ts}',

  // Build tools
  '**/gemfile',
  '**/{G,g}runtfile.{js,ts}',
  '**/{G,g}ulpfile.{js,ts}',
  '**/{M,m}akefile',

  // Images
  '**/*.jp{,e}g',
  '**/*.png',
  '**/*.gif',
  '**/*.svg',

  // Linters and formatters
  '**/.jshintrc',
  '**/.lint',
  '**/.prettier*',
  '**/prettier.config*',
  '**/biome.json{,c}',
  '**/tslint.json',
  '**/.eslintrc',
  '**/eslint*.{json,jsonc,ts}',
  '**/.ox{lint,fmt}rc.json{,c}',
  '**/ox{lint,fmt}*.{json,jsonc,ts}',
  '**/.dprint.json{,c}',

  // Git
  '**/.git/',
  '**/.gitattributes',
  '**/.gitmodules',

  // Code coverage
  '**/.nyc_output/',
  '**/.nycrc',
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

    -n, --noSize  Skips the size calc at the end, saves about 200-1000ms.
`

  console.log(usageText)
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
 * @property {( ...args: any[] ) => void} info - Logs information messages in blue
 * @property {( ...args: any[] ) => void} error - Logs error messages in red
 * @property {( ...args: any[] ) => void} success - Logs success messages in green
 */

/**
 * A utility for styled console logs
 * @type {Logger}
 */
const log = {
  info: (...x) => console.info(styleText('blue', x.join(' '))),
  error: (...x) => console.error(styleText('red', x.join(' '))),
  success: (...x) => console.log(styleText('green', x.join(' '))),
}

/**
 * Get size of node_modules
 * @param {string} dirPath - Path to node_modules
 * @returns {number}
 */
function getSize(dirPath) {
  const stdout = childProcess.execSync(`du -s ${dirPath} | awk '{print $1}'`)
  return Number(stdout)
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
 * @param {number | undefined} opts.prunedSize
 * @param {number} opts.startTime
 * @param {number} opts.itemCount
 * @param {number | undefined} opts.originalSize
 */
export function printDiff({ prunedSize, startTime, itemCount, originalSize }) {
  console.table([
    {
      Pruned:
        originalSize && prunedSize ? calcSize(originalSize, prunedSize) : 'n/a',
      Time: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      Items: itemCount,
    },
  ])
}

/**
 * @typedef Args
 * @type {object}
 * @property {string} path - Path to node_modules
 * @property {string[]} include - New glob pattern
 * @property {string[]} exclude - Existing glob pattern
 * @property {boolean} help - Prints help
 * @property {boolean} noSize - Don't show size savings
 * @property {boolean} globs - Prints globs
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
      },
    })
    if (!path) throw bail('Path not defined', undefined, true)

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
 * Removes a directory or a file
 * @param {string} file - the file or dir to remove
 */
async function rimraf(file) {
  await fs.rm(file, { recursive: true, force: true })
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
 * Removes descendant paths when an ancestor path is already present
 * @param {string[]} paths - Paths to compact
 * @returns {string[]} A sorted list without redundant child paths
 */
export function compactPaths(paths) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {string[]} */
  const compact = []

  // Sorting guarantees parents are encountered before their nested children
  for (const path of paths.toSorted()) {
    let i = path.lastIndexOf('/')

    while (i > 0) {
      if (seen.has(path.slice(0, i))) break
      i = path.lastIndexOf('/', i - 1)
    }

    // Skip this path if one of its ancestors has already been kept
    if (i > 0) continue

    seen.add(path)
    compact.push(path)
  }

  return compact
}

/**
 * Removes unneeded files from node_modules
 * @param {Args} opts
 */
export async function prune(opts) {
  const startTime = Date.now()
  log.info('Pruning:', opts.path)

  const originalSize = opts.noSize ? undefined : getSize(opts.path)
  const excludedGlobs = new Set(opts.exclude)
  const activeGlobs = [...defaultGlobs, ...opts.include].filter(
    glob => !excludedGlobs.has(glob)
  )
  const compiledGlobs = compileGlobs(activeGlobs)

  // This could be slightly faster with optimized walker
  const allFiles = await fs.readdir(opts.path, {
    recursive: true,
    withFileTypes: true,
  })

  const junkFiles = findJunkFiles(allFiles, compiledGlobs)
  const results = compactPaths(junkFiles)

  try {
    await Promise.all(results.map(x => rimraf(x)))
  } catch (err) {
    throw bail(undefined, err)
  }

  printDiff({
    itemCount: results.length,
    prunedSize: opts.noSize ? undefined : getSize(opts.path),
    originalSize,
    startTime,
  })

  return results
}

const entry = process.argv[1]
const runAsScript =
  entry && import.meta.filename.endsWith(entry.replace(process.cwd(), ''))

if (runAsScript) {
  const args = handleArgs()

  if (args.help) {
    usage()
    process.exit(0)
  }

  if (args.globs) {
    console.log(JSON.stringify(defaultGlobs, null, 2))
    process.exit(0)
  }

  await validateNodeModulesPath(args.path)
  await prune(args)
}
