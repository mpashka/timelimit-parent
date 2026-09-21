#!/usr/bin/env node
// @tag:parent-console
// Turns the sync server's published JSON schemas into TypeScript for src/core/protocol.ts.
// `node scripts/protocol-types.mjs` rewrites the generated file, `check` fails when it is stale.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const output = join(root, 'src/core/protocol.generated.ts')
const serverDir = resolve(root, process.env.TIMELIMIT_SERVER_DIR ?? '../timelimit-server')
const schemaDir = join(serverDir, 'docs/schema')

// Every wire type this client reads or sends hangs off one of these four; the server generates
// them from src/api/schema.ts and validates requests against the same schemas.
const roots = ['ServerDataStatus', 'ClientPullChangesRequest', 'ClientPushChangesRequest', 'SerializedParentAction']

const header = `/*
 * Generated from the sync server's own schemas by scripts/protocol-types.mjs — do not edit.
 * Source: timelimit-server/docs/schema/{${roots.join(',')}}.schema.json, which the server
 * generates from src/api/schema.ts and uses to validate requests (additionalProperties: false).
 * Regenerate with \`npm run protocol:types\`; \`npm test\` and \`npm run build\` fail when this
 * file no longer matches the schemas.
 *
 * Copyright (C) 2019 - 2026 Jonas Lochmann, GNU AGPL-3.0 — the shapes are the server's.
 */

// @tag:parent-console
`

function generate () {
  /** @type {Record<string, unknown>} */
  const definitions = {}
  /** @type {Array<{ name: string, schema: any }>} */
  const rootSchemas = []

  for (const name of roots) {
    const file = join(schemaDir, `${name}.schema.json`)
    const schema = JSON.parse(readFileSync(file, 'utf8'))
    for (const [defName, defSchema] of Object.entries(schema.definitions ?? {})) {
      const previous = definitions[defName]
      const text = JSON.stringify(defSchema)
      if (previous !== undefined && previous !== text) {
        throw new Error(`${defName} has two different shapes across ${roots.join(', ')}`)
      }
      definitions[defName] = text
    }
    rootSchemas.push({ name, schema })
  }

  const blocks = []
  for (const name of Object.keys(definitions).sort()) {
    blocks.push(declaration(name, JSON.parse(String(definitions[name])), name))
  }
  for (const { name, schema } of rootSchemas) {
    if (definitions[name] !== undefined) throw new Error(`${name} is both a root type and a definition`)
    blocks.push(declaration(name, schema, name))
  }
  return header + '\n' + blocks.join('\n') + '\n'
}

function declaration (name, schema, path) {
  if (schema.anyOf === undefined && schema.type === 'object' && schema.properties !== undefined) {
    return `export interface ${name} ${objectType(schema, path, '')}\n`
  }
  if (schema.anyOf !== undefined) {
    const members = schema.anyOf.map((item, i) => typeOf(item, `${path}[${i}]`))
    return `export type ${name} =\n  | ${members.join('\n  | ')}\n`
  }
  return `export type ${name} = ${typeOf(schema, path)}\n`
}

const quoted = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function typeOf (schema, path) {
  if (schema.$ref !== undefined) {
    const prefix = '#/definitions/'
    if (!schema.$ref.startsWith(prefix)) throw new Error(`${path}: cannot resolve $ref ${schema.$ref}`)
    return schema.$ref.slice(prefix.length)
  }
  if (schema.anyOf !== undefined) return schema.anyOf.map((item, i) => typeOf(item, `${path}[${i}]`)).join(' | ')
  if (schema.enum !== undefined) {
    if (schema.type !== 'string') throw new Error(`${path}: enum of ${String(schema.type)} is not supported`)
    return schema.enum.map(quoted).join(' | ')
  }
  switch (schema.type) {
    case 'string': case 'number': case 'boolean':
      return schema.type
    case 'array':
      if (schema.items === undefined) throw new Error(`${path}: array without items`)
      return `Array<${typeOf(schema.items, `${path}[]`)}>`
    case 'object':
      if (schema.properties !== undefined) return objectType(schema, path, '')
      if (typeof schema.additionalProperties === 'object') {
        return `Record<string, ${typeOf(schema.additionalProperties, `${path}[key]`)}>`
      }
      return 'Record<string, unknown>'
    default:
      throw new Error(`${path}: unsupported schema ${JSON.stringify(schema).slice(0, 120)}`)
  }
}

function objectType (schema, path, indent) {
  const required = new Set(schema.required ?? [])
  const inner = indent + '  '
  const lines = []
  for (const [property, propertySchema] of Object.entries(schema.properties)) {
    if (typeof propertySchema.description === 'string') {
      lines.push(`${inner}/** ${propertySchema.description.replace(/\s*\n\s*/g, ' ')} */`)
    }
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property) ? property : quoted(property)
    const optional = required.has(property) ? '' : '?'
    lines.push(`${inner}${key}${optional}: ${typeOf(propertySchema, `${path}.${property}`)}`)
  }
  return `{\n${lines.join('\n')}\n${indent}}`
}

const missingSchemas = () => [
  `no sync server schemas under ${schemaDir}`,
  `  looked there because TIMELIMIT_SERVER_DIR ${process.env.TIMELIMIT_SERVER_DIR === undefined ? 'is not set, so the default ../timelimit-server was used' : `points at ${serverDir}`}`,
  '  clone https://codeberg.org/timelimit/timelimit-server next to this repository, or set TIMELIMIT_SERVER_DIR to an existing clone'
].join('\n')

const mode = process.argv[2] ?? 'write'
if (mode !== 'write' && mode !== 'check') {
  console.error(`usage: node scripts/protocol-types.mjs [write|check], got ${mode}`)
  process.exit(2)
}

const haveSchemas = existsSync(schemaDir)
if (!haveSchemas && mode === 'check') {
  if (!existsSync(output)) {
    console.error(`${missingSchemas()}\n  and ${relative(root, output)} is missing too, so there is nothing to build from`)
    process.exit(1)
  }
  console.error(`${missingSchemas()}\n  building on the committed ${relative(root, output)} instead — it is not checked against the server this time`)
  process.exit(0)
}
if (!haveSchemas) {
  console.error(missingSchemas())
  process.exit(1)
}

const generated = generate()
if (mode === 'write') {
  writeFileSync(output, generated)
  console.log(`wrote ${relative(root, output)} from ${schemaDir}`)
} else if (!existsSync(output) || readFileSync(output, 'utf8') !== generated) {
  console.error([
    `${relative(root, output)} does not match the schemas in ${schemaDir}:`,
    '  the sync protocol changed under this client, and a client that keeps its own idea of the',
    '  protocol is rejected by the server at run time, not here.',
    '  Run `npm run protocol:types`, then fix whatever stops compiling and commit both.'
  ].join('\n'))
  process.exit(1)
}
