import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const harmonyRoot = path.join(root, 'platform', 'HarmonyOS')
const appResourceDir = path.join(
  harmonyRoot,
  'web_engine',
  'src',
  'main',
  'resources',
  'resfile',
  'resources',
  'app',
)

function assertInsideRoot(target) {
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside project root: ${target}`)
  }
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`Missing build output: ${from}`)
  }
  fs.cpSync(from, to, { recursive: true })
}

assertInsideRoot(appResourceDir)

fs.rmSync(appResourceDir, { recursive: true, force: true })
fs.mkdirSync(appResourceDir, { recursive: true })

copyDir(path.join(root, 'dist'), path.join(appResourceDir, 'dist'))
copyDir(path.join(root, 'dist-electron'), path.join(appResourceDir, 'dist-electron'))

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const harmonyPkg = {
  name: pkg.name,
  private: true,
  version: pkg.version,
  type: pkg.type,
  main: pkg.main,
  description: pkg.description,
  author: pkg.author,
}

fs.writeFileSync(
  path.join(appResourceDir, 'package.json'),
  `${JSON.stringify(harmonyPkg, null, 2)}\n`,
)

console.log(`HarmonyOS app resources prepared: ${path.relative(root, appResourceDir)}`)
