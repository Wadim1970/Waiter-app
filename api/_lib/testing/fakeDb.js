// Поддельный клиент Supabase в памяти — для тестов сервисов (только то
// подмножество запросов, которым они пользуются).
import crypto from 'node:crypto'

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/
function cmp(a, b) {
  if (typeof a === 'string' && typeof b === 'string' && DATE_LIKE.test(a) && DATE_LIKE.test(b) && a.length > 10 && b.length > 10) {
    return Date.parse(a) - Date.parse(b)
  }
  return a < b ? -1 : a > b ? 1 : 0
}
const parseVal = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v)

const OPS = {
  eq: (r, c, v) => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v)),
  neq: (r, c, v) => r[c] !== v,
  gt: (r, c, v) => r[c] != null && cmp(r[c], v) > 0,
  gte: (r, c, v) => r[c] != null && cmp(r[c], v) >= 0,
  lt: (r, c, v) => r[c] != null && cmp(r[c], v) < 0,
  lte: (r, c, v) => r[c] != null && cmp(r[c], v) <= 0,
  in: (r, c, v) => v.includes(r[c]),
}

class Query {
  constructor(db, table) { Object.assign(this, { db, table, filters: [], mode: 'select', orderBy: [], rangeAt: null, one: null, returning: false }) }
  select() { if (this.mode !== 'select') this.returning = true; return this }
  insert(rows) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  update(fields) { this.mode = 'update'; this.payload = fields; return this }
  delete() { this.mode = 'delete'; return this }
  or(expr) {
    const alts = expr.split(',').map((p) => { const [c, op, ...rest] = p.split('.'); return [c, op, parseVal(rest.join('.'))] })
    this.filters.push((r) => alts.some(([c, op, v]) => OPS[op](r, c, v)))
    return this
  }
  order(col, { ascending = true } = {}) { this.orderBy.push([col, ascending]); return this }
  range(a, b) { this.rangeAt = [a, b]; return this }
  limit(n) { this.rangeAt = [0, n - 1]; return this }
  maybeSingle() { this.one = 'maybe'; return this }
  single() { this.one = 'single'; return this }
  rows() { return this.db.tables[this.table] ||= [] }
  match(r) { return this.filters.every((f) => f(r)) }
  run() {
    const all = this.rows()
    let out
    if (this.mode === 'insert') {
      out = this.payload.map((p) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...p }))
      all.push(...out)
    } else if (this.mode === 'update') {
      out = all.filter((r) => this.match(r))
      out.forEach((r) => Object.assign(r, this.payload))
    } else if (this.mode === 'delete') {
      out = all.filter((r) => this.match(r))
      this.db.tables[this.table] = all.filter((r) => !this.match(r))
    } else {
      out = all.filter((r) => this.match(r))
      if (this.orderBy.length) {
        out = [...out].sort((a, b) => {
          for (const [c, asc] of this.orderBy) {
            const d = cmp(a[c], b[c])
            if (d) return asc ? d : -d
          }
          return 0
        })
      }
      if (this.rangeAt) out = out.slice(this.rangeAt[0], this.rangeAt[1] + 1)
    }
    out = out.map((r) => ({ ...r }))
    if (this.one) {
      if (out.length > 1) return { data: null, error: new Error('multiple rows') }
      if (this.one === 'single' && out.length === 0) return { data: null, error: new Error('no rows') }
      return { data: out[0] || null, error: null }
    }
    return { data: out, error: null }
  }
  then(resolve, reject) { try { resolve(this.run()) } catch (e) { reject(e) } }
}
for (const op of Object.keys(OPS)) {
  Query.prototype[op] = function (c, v) { this.filters.push((r) => OPS[op](r, c, v)); return this }
}

// rpcs — функции базы: { имя: (аргументы) => результат }.
export function fakeDb(tables = {}, rpcs = {}) {
  const db = { tables: structuredClone(tables) }
  db.from = (t) => new Query(db, t)
  db.rpc = async (name, args) => ({ data: rpcs[name] ? rpcs[name](args, db) : null, error: rpcs[name] ? null : { code: '42883', message: `function ${name} does not exist` } })
  return db
}
