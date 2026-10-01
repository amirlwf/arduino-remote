#!/usr/bin/env node
/**
 * Injects reachable Maven mirrors (Aliyun) into every Gradle file in this repo
 * (android/ project + capacitor/cordova modules under node_modules) so builds
 * succeed on networks where dl.google.com is blocked. Idempotent, safe to rerun.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  path.join(root, 'android'),
  path.join(root, 'node_modules', '@capacitor'),
  path.join(root, 'node_modules', 'cordova-android'),
  path.join(root, 'node_modules', '@capacitor-community'),
]

const MIRRORS = [
  "maven { url 'https://maven.aliyun.com/repository/google' }",
  "maven { url 'https://maven.aliyun.com/repository/public' }",
  "maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }",
]

let patched = 0

function walk(dir, depth = 0) {
  if (depth > 6) return
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.gradle') continue
      walk(full, depth + 1)
    } else if (e.name.endsWith('.gradle') || e.name.endsWith('.gradle.kts')) {
      fix(full)
    }
  }
}

function fix(file) {
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { return }
  if (!src.includes('google()') || src.includes('maven.aliyun.com')) return
  const out = []
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*google\(\)$/.test(line)) {
      const ind = line.match(/^\s*/)[0]
      for (const m of MIRRORS) out.push(ind + m)
    }
    out.push(line)
  }
  fs.writeFileSync(file, out.join('\n'), 'utf8')
  patched++
  console.log('patched:', path.relative(root, file))
}

for (const r of roots) walk(r)
console.log('mirror injection complete, files patched:', patched)
