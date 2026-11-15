/**
 * Learned skills (feature 3.5): after doing a task once, an agent can save
 * how as a skill and reuse it. Skills are Markdown files the user can read,
 * edit and delete, in the app's data folder (`skills/<name>.md`), with a
 * short header: name, description, who wrote it and when.
 *
 * The data folder is off-limits to agents' file tools; skills are reached
 * only through this module, so a skill can't be planted by writing a file.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Skill } from '../../shared/protocol'
import { redact } from '../redact'

const NAME = /^[a-z0-9][a-z0-9-]{1,60}$/
const MAX_BODY = 20_000

export class SkillError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillError'
  }
}

export function skillName(text: string): string {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (!NAME.test(name)) throw new SkillError('Give the skill a short name of letters and numbers.')
  return name
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function serialize(skill: Skill): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${oneLine(skill.description, 300)}`,
    `source: ${oneLine(skill.source, 200)}`,
    `updated: ${new Date(skill.updatedAt).toISOString()}`,
    '---',
    '',
    skill.body.trim(),
    ''
  ].join('\n')
}

function parse(name: string, text: string): Skill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const header: Record<string, string> = {}
  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) header[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  const updated = Date.parse(header.updated ?? '')
  return {
    name,
    description: header.description ?? '',
    source: header.source ?? 'you',
    body: (match ? match[2] : text).trim(),
    updatedAt: Number.isNaN(updated) ? 0 : updated
  }
}

export interface SkillStore {
  list(): Skill[]
  get(name: string): Skill | null
  save(input: { name: string; description: string; body: string; source: string }): Skill
  remove(name: string): void
}

/** Skills as files in `dir`, or in memory when `dir` is null (tests). */
export function createSkillStore(
  dir: string | null,
  onChange: () => void = () => undefined
): SkillStore {
  const memory = new Map<string, string>()
  const file = (name: string): string => join(dir!, `${name}.md`)

  function readRaw(name: string): string | null {
    if (!dir) return memory.get(name) ?? null
    try {
      return readFileSync(file(name), 'utf8')
    } catch {
      return null
    }
  }

  const store: SkillStore = {
    list() {
      const names = dir
        ? (() => {
            try {
              return readdirSync(dir)
                .filter((f) => f.endsWith('.md'))
                .map((f) => f.slice(0, -3))
            } catch {
              return []
            }
          })()
        : [...memory.keys()]
      return names
        .filter((n) => NAME.test(n))
        .map((n) => store.get(n))
        .filter((s): s is Skill => s !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    get(name) {
      if (!NAME.test(name)) return null
      const raw = readRaw(name)
      return raw === null ? null : parse(name, raw)
    },

    save(input) {
      const name = skillName(input.name)
      const body = redact(String(input.body ?? '')).trim()
      if (!body) throw new SkillError('A skill needs its steps.')
      if (body.length > MAX_BODY) throw new SkillError('That skill is too long.')
      const skill: Skill = {
        name,
        description: oneLine(redact(String(input.description ?? '')), 300) || name,
        source: input.source,
        body,
        updatedAt: Date.now()
      }
      if (dir) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file(name), serialize(skill), 'utf8')
      } else memory.set(name, serialize(skill))
      onChange()
      return skill
    },

    remove(name) {
      if (!NAME.test(name)) return
      if (dir) rmSync(file(name), { force: true })
      else memory.delete(name)
      onChange()
    }
  }
  return store
}

/** What a tool may do with skills. */
export interface SkillAccess {
  list(): Skill[]
  read(name: string): Skill
  save(input: { name: string; description: string; body: string }): Skill
}
