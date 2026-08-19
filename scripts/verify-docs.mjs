import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const required = [
  'README.md',
  'AGENTS.md',
  'LICENSE',
  'docs/PRD.md',
  'docs/CAPABILITIES.md',
  'docs/ARCHITECTURE.md',
  'docs/SDK.md',
  'docs/TECH-STACK.md',
  'docs/SECURITY.md',
  'docs/UPSTREAM.md',
  'docs/ROADMAP.md',
  'docs/DOD.md',
  'docs/adr/0001-react-native-expo.md',
  'docs/adr/0002-app-scaffold-baseline.md',
  'llmdoc/index.md',
  'llmdoc/startup.md',
  'llmdoc/must/evidence-language.md',
  'llmdoc/must/project-basics.md',
  'llmdoc/must/safety-boundaries.md',
]

const failures = []

for (const file of required) {
  try {
    await access(join(root, file))
  } catch {
    failures.push(`缺少必需文件: ${file}`)
  }
}

const ignoredDirectories = new Set([
  '.expo',
  '.git',
  '.llmdoc-tmp',
  'android',
  'coverage',
  'dist',
  'ios',
  'node_modules',
])

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

for (const file of await markdownFiles(root)) {
  const source = await readFile(file, 'utf8')
  const relativePath = relative(root, file)

  if (!source.endsWith('\n')) failures.push(`${relativePath}: 文件末尾缺少换行`)
  if (/\b(TODO|TBD)\b/.test(source)) {
    failures.push(`${relativePath}: 使用明确的“未决定/未实现”说明，不保留 TODO/TBD`)
  }

  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (
      target.startsWith('http://')
      || target.startsWith('https://')
      || target.startsWith('#')
      || target.startsWith('mailto:')
    ) continue
    const withoutAnchor = target.split('#')[0]
    if (!withoutAnchor) continue
    const local = resolve(dirname(file), decodeURIComponent(withoutAnchor))
    try {
      await access(local)
    } catch {
      failures.push(`${relativePath}: 本地链接不存在: ${target}`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`文档验证通过：${required.length} 个必需文件，本地链接完整。`)
}
