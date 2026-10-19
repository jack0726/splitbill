import { execFileSync } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

const packagePath = new URL('../package.json', import.meta.url)
const lockPath = new URL('../package-lock.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
const packageLock = JSON.parse(await readFile(lockPath, 'utf8'))
const sha = process.env.PUSHED_SHA
const timestamp = process.env.PUSHED_AT

if (!sha || !timestamp) throw new Error('PUSHED_SHA and PUSHED_AT are required')

const date = new Date(timestamp)
if (Number.isNaN(date.valueOf())) throw new Error(`Invalid push timestamp: ${timestamp}`)

const parentPackageJson = JSON.parse(execFileSync('git', ['show', `${sha}^:package.json`], { encoding: 'utf8' }))
if (packageJson.version === parentPackageJson.version) {
  const parts = packageJson.version.split('.').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Expected a semantic version in package.json, received ${packageJson.version}`)
  }
  parts[2] += 1
  packageJson.version = parts.join('.')
}
packageLock.version = packageJson.version
packageLock.packages[''].version = packageJson.version
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
await writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`)

const entry = `| ${packageJson.version} | ${date.toISOString().slice(0, 10)} | [${sha.slice(0, 7)}](https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${sha}) |\n`
await appendFile(new URL('../VERSIONS.md', import.meta.url), entry)
