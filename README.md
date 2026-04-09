# prod-files

Keep only production related files in `node_modules`, remove files which are not
needed to run the app in production, so your final Docker images is smaller and
you spend less time and resources zooting ballast over internet.

Cuts anything from 10 to 70+ percent of weight, largely depending on how many
source map files you have, which is usually the bulk of the weight. Comes handy
if you’re dealing with limited resources or work at a scale of thousands of
projects, or you’re just obsessed with small deployments.

It's relatively fast, prunes
[Sentry's `node_modules`](https://github.com/getsentry/sentry/blob/master/package.json)
in 1.8s (M2 MacBook). Prod deps only though, installed with `pnpm i --prod`, but
that's the common use-case anyway.

## Install

```sh
pnpm add prod-files
```

It’s a single JavaScript file with no deps, so you can easily copy it to your
project if you don’t want to install it.

## Usage

```
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
```

With a package manager:

```sh
pnpm prod-files node_modules/.pnpm
# Short
pnpm pf node_modules/.pnpm
# pnpx/npx
pnpx prod-files node_modules/.pnpm
```

Different package manager `node_modules` paths:

| Manager | Linker       | Path                  | Description     |
| ------- | ------------ | --------------------- | --------------- |
| pnpm    | -            | `node_modules/.pnpm`  | hard-linked     |
| npm     | -            | `node_modules`        | the good old    |
| yarn v1 | -            | `node_modules`        | the good old    |
| yarn    | node-modules | `node_modules`        | the good old    |
| yarn    | pnpm         | `node_modules/.store` | same as pnpm    |
| yarn    | pnp          | no-op                 | no node_modules |

### Dockerfile example

Simple yet somewhat realistic example usage in Dockerfile for an app named `foo`
using pnpm:

```dockerfile
FROM node:lts-alpine3.19 AS base
WORKDIR /usr/src/app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . ./
RUN pnpm i --offline --frozen-lockfile
RUN pnpm build
RUN pnpm -F=foo --prod deploy /foo
# Run it as the last command of the build step. NOTE: if you installed with
# --prod flag, prod-files needs to be a prod dep. Or use pnpx/npx/yarn dlx
WORKDIR /foo
RUN pnpm prod-files node_modules/.pnpm --noSize

# Enjoy your new slimmer image
FROM node:lts-alpine3.19 AS foo
COPY --from=base foo/build /foo/build
COPY --from=base foo/node_modules /foo/node_modules
WORKDIR /foo
CMD node build/server.js
```

Or use wget in if you don't have a package manager in your env (there are
certain risks involved when you execute files downloaded from the net, if I get
comprised that file can have anything):

```dockerfile
RUN wget -O pf.js https://raw.githubusercontent.com/hilja/prod-files/refs/heads/main/index.mjs
RUN node pf.js my-app/foo/node_modules/.pnpm
```

## Development

```sh
pnpm i
```

### Unit tests

Unit tests are written with node's test utils.

```sh
pnpm test
```

### End to end tests

In `test-project` directory has Sentry's `package.json`. You can run the script
against it to see how it does in real-world use and get some timing data.

```sh
# Re-installs the packages and runs the script on it
pnpm test:e2e
# Disable size reportings since it adds 200-300ms
pnpm test:e2e --noSize
```

The nuke command removes `node_modules` and prunes the store:

```sh
pnpm test:e2e:nuke
```

There's also a simple script to print the weight of `test-project/node_modules/`
using `du`. You can run it before and after to see more detailed results:

```sh
pnpm test:e2e:weight
```

## Prior art

- [npmprune](https://github.com/xthezealot/npmprune) (bash)
- [node-prune](https://github.com/tuananh/node-prune) (go)
- [clean-modules](https://github.com/duniul/clean-modules) (node)
