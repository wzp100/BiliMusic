import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const harmonyRoot = path.join(root, 'platform', 'HarmonyOS')

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(checker, [command], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  }).status === 0
}

const candidates = [
  process.env.HVIGOR_BIN && {
    command: process.env.HVIGOR_BIN,
    available: fs.existsSync(process.env.HVIGOR_BIN) || commandExists(process.env.HVIGOR_BIN),
  },
  {
    command: path.join(harmonyRoot, 'hvigorw.bat'),
    available: fs.existsSync(path.join(harmonyRoot, 'hvigorw.bat')),
  },
  {
    command: path.join(harmonyRoot, 'hvigorw'),
    available: fs.existsSync(path.join(harmonyRoot, 'hvigorw')),
  },
  { command: 'hvigorw', available: commandExists('hvigorw') },
  { command: 'hvigor', available: commandExists('hvigor') },
].filter(Boolean)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: harmonyRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return result.status === 0
}

let built = false
for (const candidate of candidates.filter((item) => item.available)) {
  console.log(`Trying HarmonyOS build with: ${candidate.command}`)
  if (run(candidate.command, ['--mode', 'module', '-p', 'module=electron@default', 'assembleHap'])) {
    built = true
    break
  }
}

if (!built) {
  console.error('HarmonyOS hvigor build tool was not found or build failed. Open platform/HarmonyOS in DevEco Studio and run Build Hap(s), or set HVIGOR_BIN to your hvigor executable.')
  process.exit(1)
}
