# Releasing

1. Bump `version` in `package.json` and the `user-agent` string in `src/index.ts`; commit to `main`.
2. Tag and push: `git tag v0.1.1 && git push origin v0.1.1`.
3. The `release` workflow checks the tag against `package.json`, tests, builds and publishes with provenance.

The first version, 0.1.0, is published by hand (`npm publish`) because npm's trusted-publisher
record can only be added to a package that exists. After that, on npmjs.com open the package's
Settings, add a Trusted Publisher: GitHub Actions, organization `jevlinai`, repository
`jevlin-ai-sdk`, workflow `release.yml`, environment `release`. Create the `release` environment
in this repository's settings as well.

`npm publish` covers pnpm, yarn and bun too: they all install from the npm registry.
