/**
 * In-memory stand-in for the Kysely database used by the storage layer.
 *
 * The storage modules reach PostgreSQL exclusively through `getDb()` behind
 * `isDatabaseAvailable()` (server/storage/utils/db-guard.js). Installing this
 * double with `__setTestDb()` therefore makes those modules exercisable
 * without a live server, which is what lets the identity/auth tests assert
 * real query behaviour instead of grepping source.
 *
 * It implements the query shapes the storage layer actually uses, not Kysely
 * as a whole:
 *   selectFrom / select / selectAll / distinctOn / innerJoin / leftJoin /
 *   where / orderBy / limit / offset / clearSelect / execute / executeTakeFirst,
 *   insertInto / values / returningAll / onConflict (doNothing + doUpdateSet),
 *   updateTable / set, deleteFrom / returning, and `db.fn.count()`.
 *
 * Table references may carry an alias (`selectFrom('presentation_collaborators
 * as c').innerJoin('presentations as p', …)`, the "shared with me" query): the
 * alias shadows the real name for column resolution, as in SQL.
 *
 * Four behaviours are modelled on purpose because tests depend on them:
 *   1. UNIQUE constraints (notably the globally unique `users.email`) throw the
 *      way PostgreSQL does, so a code path that wrongly tries to insert a
 *      second row for an existing person fails loudly in tests.
 *   2. Every table touched is recorded in `db.__queryLog`, so a test can assert
 *      that single-organization mode issues no membership lookups at all.
 *   3. Kysely leaves `undefined` values out of the SET/VALUES clause it
 *      compiles, so such a column keeps its stored value. The difference
 *      between that and an explicit `null` is the whole subject of the
 *      partial-write tests, so the double drops `undefined` too.
 *   4. `sql` template values (the storage layer writes `sql`revision + 1``) are
 *      evaluated for the shapes that layer uses — `<column> ± <number>` and
 *      `now()` in a SET clause, and in ORDER BY a `CASE <column> WHEN … THEN
 *      <n> … END` rank, a `<column> = '<literal>'` boolean flag, and
 *      `cardinality(<column>)` array length —
 *      and anything else throws rather than being silently ignored or stored as
 *      a builder object. An ORDER BY the double quietly dropped would make an
 *      ordering test pass on insertion order, which is the failure mode that
 *      matters most here. The callback form of `.set()` (`(eb) => ({ use_count:
 *      eb('use_count', '+', 1) })`, the share-link use counter) is resolved for
 *      the same reason.
 */

import crypto from 'node:crypto';

/**
 * UNIQUE constraints enforced by the double, mirroring the migrations.
 * `users.email` is globally unique since 001_initial_schema.js:28; the
 * membership pair comes from 031_user_organizations.js.
 *
 * Exported so `scripts/check-test-double-schema.js` can hold it against the
 * schema the migrations actually produce. "Mirroring the migrations" was a
 * promise nothing checked until then — and #423 was a case of it being wrong.
 */
export const UNIQUE_CONSTRAINTS = {
  users: [['email']],
  user_organizations: [['user_id', 'organization_id']],
  organizations: [['slug']],
  // slide_locks unique is on (presentation_id, slide_id) only — organization_id
  // is NOT part of it (migration 023_slide_locks.js). Matching the real columns
  // is what lets the acquire-race test exercise the ON CONFLICT path.
  slide_locks: [['presentation_id', 'slide_id']],
  // Migration 061 woke the live-interaction tables. Both upserts run on every
  // vote and every feedback submission, so the double has to collide the way
  // PostgreSQL does or the "one answer per device" rule is only enforced in
  // production. `interaction_votes` is not listed: its rule is the primary key
  // (interaction_id, device_id), which the double models as identity.
  interactions: [['session_id', 'slide_id']],
  feedback: [['session_id', 'slide_id', 'device_id']],
};

/**
 * jsonb columns. The storage layer writes them via the `jsonb()` helper, which
 * hands the driver a JSON string; PostgreSQL stores it as jsonb and reads it
 * back as a parsed value. The double reproduces that round-trip so tests see
 * objects on read, exactly like production.
 *
 * Exported for the same reason as {@link UNIQUE_CONSTRAINTS}: a column listed
 * here that is not jsonb in the real schema makes the double parse something
 * PostgreSQL never serialized.
 */
export const JSONB_COLUMNS = {
  users: ['settings'],
  organizations: ['settings'],
  // Migration 059 replaced the per-organization app_settings (whose `webhooks`
  // column sat here) with a singleton jsonb bag, and added user_settings with
  // the same one-bag shape.
  app_settings: ['settings'],
  user_settings: ['settings'],
  auth_audit_log: ['metadata'],
  presentations: ['settings', 'i18n', 'slides', 'published', 'sandbox'],
  presentation_versions: ['presentation_data'],
  present_sessions: ['state', 'follow_codes'],
  // Migration 061: `texts` is the per-language map of a question.
  questions: ['texts'],
  // Migrations 017/041/043: a comment's proposed slide, create-time slide
  // snapshot and parsed @-mentions are jsonb.
  presentation_comments: ['proposed_slide', 'slide_snapshot', 'mentions'],
};

/**
 * Apply the jsonb write conversion for a table's row.
 * @param {string} table - Table name
 * @param {Object} row - Row about to be stored
 * @returns {Object}
 */
function parseJsonbColumns(table, row) {
  const columns = JSONB_COLUMNS[table];
  if (!columns) return row;
  const out = { ...row };
  for (const column of columns) {
    if (typeof out[column] === 'string') {
      try {
        out[column] = JSON.parse(out[column]);
      } catch {
        // Not JSON: leave the value untouched rather than guess.
      }
    }
  }
  return out;
}

/**
 * Is this a Kysely `sql` template value rather than a plain column value?
 * @param {*} value - Value from a VALUES/SET object
 * @returns {boolean}
 */
function isRawExpression(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.toOperationNode === 'function'
  );
}

/**
 * Evaluate a `sql` template against the row it updates.
 *
 * Two shapes are understood: `<column> ± <number>` (the `revision + 1` write)
 * and `now()` (the server-clock timestamp `writeUserSettings` stamps on
 * `updated_at`), which resolves to an ISO string as PostgreSQL's `now()` would
 * to a timestamp. Anything else throws, so an unmodelled expression fails the
 * test instead of landing in a row as a builder object.
 *
 * @param {*} value - Raw expression from a SET object
 * @param {Object} row - Row being updated
 * @param {string} column - Column being written
 * @returns {*}
 */
function evaluateRawExpression(value, row, column) {
  const node = value.toOperationNode();
  const fragments = Array.isArray(node?.sqlFragments) ? node.sqlFragments : [];
  const text = fragments.join('').trim();
  if ((node.parameters || []).length === 0 && /^now\(\)$/i.test(text)) {
    return new Date().toISOString();
  }
  const arithmetic = text.match(/^"?([a-z_]+)"?\s*([+-])\s*(\d+)$/i);
  if (arithmetic && (node.parameters || []).length === 0) {
    const [, operand, operator, amount] = arithmetic;
    const base = Number(row[operand]) || 0;
    return operator === '+' ? base + Number(amount) : base - Number(amount);
  }
  throw new Error(
    `fake-db: unsupported sql expression for "${column}": ${text}`,
  );
}

/**
 * Is this an expression-builder node rather than a plain value?
 *
 * `.set((eb) => ({ use_count: eb('use_count', '+', 1) }))` hands the SET clause
 * the same node shape `where()` callbacks produce, so only the operator tells a
 * comparison from arithmetic.
 *
 * @param {*} value - Value from a SET/VALUES object
 * @returns {boolean}
 */
function isBuilderNode(value) {
  return !!value && typeof value === 'object' && value.kind === 'cmp';
}

/**
 * Evaluate an expression-builder node used as a written value.
 *
 * Only `<column> + <number>` and `<column> - <number>` are understood — the
 * shape `verifyShareLinkAccess` writes for the share-link use counter. Anything
 * else throws for the same reason {@link evaluateRawExpression} does: a
 * counter the double silently left alone would make a "the link is spent now"
 * assertion pass without the counter ever moving.
 *
 * @param {Object} node - Expression-builder node
 * @param {Object} row - Row being updated
 * @param {string} column - Column being written
 * @returns {number}
 */
function evaluateBuilderArithmetic(node, row, column) {
  if (node.op !== '+' && node.op !== '-') {
    throw new Error(
      `fake-db: unsupported expression-builder operator "${node.op}" for "${column}"`,
    );
  }
  const base = Number(readColumn(row, node.column)) || 0;
  const amount = Number(node.value);
  return node.op === '+' ? base + amount : base - amount;
}

/**
 * Drop `undefined` values the way Kysely does when it compiles a SET or VALUES
 * clause, and resolve any `sql` template or expression-builder node against the
 * row being written.
 *
 * @param {Object} input - SET/VALUES object as the storage layer wrote it
 * @param {Object} [row] - Row being updated, for raw expressions
 * @returns {Object}
 */
function resolveWriteValues(input, row = {}) {
  const out = {};
  for (const [column, value] of Object.entries(input || {})) {
    if (value === undefined) continue;
    if (isRawExpression(value)) {
      out[column] = evaluateRawExpression(value, row, column);
    } else if (isBuilderNode(value)) {
      out[column] = evaluateBuilderArithmetic(value, row, column);
    } else {
      out[column] = value;
    }
  }
  return out;
}

/**
 * Compile a `sql` CASE expression used as a sort key into a ranking function.
 *
 * Only `CASE <column> WHEN '<value>' THEN <n> … [ELSE <n>] END` is understood —
 * the shape `listOrganizationMembers` uses to sort owner → admin → member,
 * which plain `ORDER BY role DESC` cannot express. Anything else throws, so an
 * unmodelled ORDER BY fails the test rather than silently leaving rows in
 * insertion order and letting an ordering assertion pass by luck.
 *
 * @param {*} value - Raw expression handed to `orderBy`
 * @returns {(row: Object) => number} Rank for a row context
 */
function compileCaseRank(value) {
  const node = value.toOperationNode();
  const fragments = Array.isArray(node?.sqlFragments) ? node.sqlFragments : [];
  const text = fragments.join('').replace(/\s+/g, ' ').trim();

  const shape = text.match(/^CASE\s+(\S+)\s+(.*?)\s*END$/i);
  if (!shape || (node.parameters || []).length) {
    throw new Error(`fake-db: unsupported sql expression in orderBy: ${text}`);
  }

  const [, column, arms] = shape;
  const whens = [...arms.matchAll(/WHEN\s+'([^']*)'\s+THEN\s+(-?\d+)/gi)].map(
    (m) => [m[1], Number(m[2])],
  );
  const fallback = arms.match(/ELSE\s+(-?\d+)/i);
  if (!whens.length) {
    throw new Error(`fake-db: unsupported CASE arms in orderBy: ${text}`);
  }

  const table = new Map(whens);
  const otherwise = fallback ? Number(fallback[1]) : Number.MAX_SAFE_INTEGER;
  return (row) => {
    const key = readColumn(row, column);
    return table.has(key) ? table.get(key) : otherwise;
  };
}

/**
 * Rank function for a raw `sql` expression handed to `orderBy`. Handles the
 * three shapes the storage layer sorts by, and defers to {@link compileCaseRank}
 * for the CASE form:
 *
 *   - `<column> = '<literal>'` — a boolean flag (true sorts as 1), the way
 *     `listQuestions` floats promoted questions to the top.
 *   - `cardinality(<column>)` — the length of an array column, how the same
 *     query ranks questions by their upvoter count.
 *
 * Anything else throws, so an unmodelled ORDER BY fails loudly rather than
 * silently leaving rows in insertion order.
 *
 * @param {*} value - Raw expression handed to `orderBy`
 * @returns {(row: Object) => number} Rank for a row context
 */
function compileRawOrder(value) {
  const node = value.toOperationNode();
  const fragments = Array.isArray(node?.sqlFragments) ? node.sqlFragments : [];
  const text = fragments.join('').replace(/\s+/g, ' ').trim();

  const boolEq = text.match(/^(\w+)\s*=\s*'([^']*)'$/);
  if (boolEq && !(node.parameters || []).length) {
    const [, column, literal] = boolEq;
    return (row) => (readColumn(row, column) === literal ? 1 : 0);
  }

  const cardinality = text.match(/^cardinality\(\s*(\w+)\s*\)$/i);
  if (cardinality && !(node.parameters || []).length) {
    const [, column] = cardinality;
    return (row) => {
      const v = readColumn(row, column);
      return Array.isArray(v) ? v.length : 0;
    };
  }

  return compileCaseRank(value);
}

/** Error shaped like a pg unique violation, so callers can recognise it. */
class UniqueViolationError extends Error {
  constructor(table, columns, value) {
    super(
      `duplicate key value violates unique constraint "${table}_${columns.join('_')}_key" ` +
        `(${columns.join(', ')})=(${value})`,
    );
    this.name = 'UniqueViolationError';
    this.code = '23505';
    this.table = table;
    this.columns = columns;
  }
}

const lastSegment = (column) => String(column).split('.').pop();

/**
 * Split a table reference into the stored table and the name it is addressed
 * by. `selectFrom('presentation_collaborators as c')` reads the collaborators
 * table but qualifies its columns `c.*`; without this the double looked for a
 * table literally named "presentation_collaborators as c", found none, and
 * answered every aliased query with an empty result — so a join that returns
 * nothing in production and a join the double cannot compile were
 * indistinguishable. An alias shadows the real name, exactly as in SQL.
 *
 * @param {string} ref - Table reference, e.g. 'users' or 'presentations as p'
 * @returns {{table: string, alias: string}}
 */
function parseTableRef(ref) {
  const match = String(ref).match(/^(\S+)\s+as\s+(\S+)$/i);
  return match
    ? { table: match[1], alias: match[2] }
    : { table: String(ref), alias: String(ref) };
}

/**
 * Resolve a possibly qualified column reference against a row context.
 * @param {Object} row - Row context (qualified and unqualified keys)
 * @param {string} column - Column reference, e.g. 'email' or 'users.email'
 * @returns {*}
 */
function readColumn(row, column) {
  if (column in row) return row[column];
  return row[lastSegment(column)];
}

/**
 * Evaluate one comparison the way the storage layer writes them.
 * @param {*} left - Column value
 * @param {string} op - Operator
 * @param {*} right - Comparison value
 * @returns {boolean}
 */
function compare(left, op, right) {
  switch (op) {
    case '=':
      return left === right;
    case '!=':
    case '<>':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case 'is':
      return right === null
        ? left === null || left === undefined
        : left === right;
    case 'is not':
      return right === null
        ? left !== null && left !== undefined
        : left !== right;
    case 'in':
      return Array.isArray(right) && right.includes(left);
    case 'not in':
      return Array.isArray(right) && !right.includes(left);
    case 'like':
    case 'ilike': {
      const pattern = String(right ?? '');
      const haystack = String(left ?? '');
      const rx = new RegExp(
        `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('%', '.*')}$`,
        op === 'ilike' ? 'i' : '',
      );
      return rx.test(haystack);
    }
    default:
      throw new Error(`fake-db: unsupported operator "${op}"`);
  }
}

/** Build the expression-builder callbacks accept (`eb`, `eb.or`, `eb.and`, `eb.fn`). */
function makeExpressionBuilder() {
  const eb = (column, op, value) => ({ kind: 'cmp', column, op, value });
  eb.or = (predicates) => ({ kind: 'or', predicates });
  eb.and = (predicates) => ({ kind: 'and', predicates });
  eb.fn = {
    count: (column) =>
      makeAggregate(
        (list) =>
          list.filter((context) => readColumn(context, column) !== undefined)
            .length,
      ),
    countAll: () => makeAggregate((list) => list.length),
  };
  return eb;
}

/**
 * An aggregate projection entry, `.as()`-able like Kysely's.
 * @param {(list: Array<Object>) => *} compute - Reduce the matched rows
 * @returns {Object}
 */
function makeAggregate(compute) {
  const aggregate = { __aggregate: true, alias: 'count', compute };
  aggregate.as = (alias) => ({ ...aggregate, alias });
  return aggregate;
}

/**
 * @param {Object} row - Row context
 * @param {Object} predicate - Predicate tree
 * @returns {boolean}
 */
function matches(row, predicate) {
  if (predicate.kind === 'cmp') {
    return compare(
      readColumn(row, predicate.column),
      predicate.op,
      predicate.value,
    );
  }
  if (predicate.kind === 'or') {
    return predicate.predicates.some((p) => matches(row, p));
  }
  if (predicate.kind === 'and') {
    return predicate.predicates.every((p) => matches(row, p));
  }
  throw new Error(`fake-db: unsupported predicate "${predicate.kind}"`);
}

/**
 * Merge a row into a join context under both its qualified and (when free)
 * unqualified names, so `where('users.email', ...)` and `where('email', ...)`
 * both resolve.
 * @param {Object} context - Accumulated row context
 * @param {string} table - Table name
 * @param {Object} row - Source row
 * @returns {Object}
 */
function mergeIntoContext(context, table, row) {
  const merged = { ...context };
  for (const [key, value] of Object.entries(row)) {
    merged[`${table}.${key}`] = value;
    if (!(key in merged)) merged[key] = value;
  }
  return merged;
}

/**
 * Create the in-memory database double.
 *
 * @param {Object<string, Array<Object>>} [seed] - Initial rows per table
 * @returns {Object} Kysely-shaped double with `__tables` and `__queryLog`
 */
export function createFakeDb(seed = {}) {
  /** @type {Object<string, Array<Object>>} */
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }

  /** @type {Array<{op: string, table: string}>} */
  const queryLog = [];

  const rowsOf = (table) => {
    if (!tables[table]) tables[table] = [];
    return tables[table];
  };

  const assertUnique = (table, candidate, ignoreRow = null) => {
    for (const columns of UNIQUE_CONSTRAINTS[table] || []) {
      if (
        columns.some((c) => candidate[c] === undefined || candidate[c] === null)
      )
        continue;
      const clash = rowsOf(table).find(
        (row) =>
          row !== ignoreRow && columns.every((c) => row[c] === candidate[c]),
      );
      if (clash) {
        throw new UniqueViolationError(
          table,
          columns,
          columns.map((c) => candidate[c]).join(', '),
        );
      }
    }
  };

  /**
   * Shared filter/projection machinery for SELECT builders.
   * @param {string} table - Base table
   * @returns {Object}
   */
  function selectBuilder(tableRef, seedState = null) {
    const { table, alias } = parseTableRef(tableRef);
    queryLog.push({ op: 'select', table });

    const state = seedState || {
      joins: [],
      predicates: [],
      projection: null,
      aggregates: [],
      orderBy: [],
      limit: null,
      offset: 0,
      selectAll: false,
    };

    const contexts = () => {
      let list = rowsOf(table).map((row) => ({
        __source: { [alias]: row },
        ...mergeIntoContext({}, alias, row),
      }));

      for (const join of state.joins) {
        queryLog.push({ op: 'join', table: join.table });
        const joined = [];
        for (const context of list) {
          const partner = rowsOf(join.table).find(
            (row) =>
              mergeIntoContext(context, join.alias, row)[join.left] ===
              mergeIntoContext(context, join.alias, row)[join.right],
          );
          if (partner) {
            joined.push({
              ...mergeIntoContext(context, join.alias, partner),
              __source: { ...context.__source, [join.alias]: partner },
            });
          } else if (join.type === 'left') {
            joined.push(context);
          }
        }
        list = joined;
      }

      list = list.filter((context) =>
        state.predicates.every((predicate) => matches(context, predicate)),
      );

      for (const { column, direction } of [...state.orderBy].reverse()) {
        const read = isRawExpression(column)
          ? compileRawOrder(column)
          : (row) => readColumn(row, column);
        list.sort((a, b) => {
          const left = read(a);
          const right = read(b);
          if (left === right) return 0;
          const cmp = left > right ? 1 : -1;
          return direction === 'desc' ? -cmp : cmp;
        });
      }

      if (state.offset) list = list.slice(state.offset);
      if (state.limit !== null) list = list.slice(0, state.limit);
      return list;
    };

    // PostgreSQL hands every read a freshly parsed value; nothing a caller
    // does to a returned row can reach the stored one. The double must match,
    // or a test that mutates a read result in place silently rewrites the
    // "stored" state and e.g. a diff-against-existing guard never fires.
    const detach = (value) =>
      value && typeof value === 'object' ? structuredClone(value) : value;

    const project = (context) => {
      if (state.aggregates.length) return null;
      if (state.selectAll || !state.projection) {
        const out = {};
        for (const [key, value] of Object.entries(context)) {
          if (key === '__source' || key.includes('.')) continue;
          out[key] = detach(value);
        }
        return out;
      }
      const out = {};
      for (const item of state.projection) {
        out[item.alias] = detach(readColumn(context, item.column));
      }
      return out;
    };

    const builder = {
      innerJoin(joinTable, left, right) {
        state.joins.push({
          ...parseTableRef(joinTable),
          left,
          right,
          type: 'inner',
        });
        return builder;
      },
      leftJoin(joinTable, left, right) {
        state.joins.push({
          ...parseTableRef(joinTable),
          left,
          right,
          type: 'left',
        });
        return builder;
      },
      select(columns) {
        // `.select((eb) => eb.fn.countAll().as('count'))` — the callback form
        // the counting queries use. Resolve it before treating entries as
        // column references, or the function would be stringified into a
        // nonsense projection and the count would silently come back as 0.
        const resolved =
          typeof columns === 'function'
            ? columns(makeExpressionBuilder())
            : columns;
        const list = Array.isArray(resolved) ? resolved : [resolved];
        state.projection = state.projection || [];
        for (const entry of list) {
          if (entry && typeof entry === 'object' && entry.__aggregate) {
            state.aggregates.push(entry);
            continue;
          }
          const [column, , alias] = String(entry).split(/\s+/);
          state.projection.push({
            column,
            alias: alias || lastSegment(column),
          });
        }
        return builder;
      },
      selectAll() {
        state.selectAll = true;
        return builder;
      },
      /**
       * Drop the projection and hand back a *separate* builder, the way Kysely's
       * immutable builders do. The paginated readers build one filtered query
       * and then branch it — `query.clearSelect().select(count)` for the total,
       * `query.orderBy(…).limit(…)` for the page — so a shared mutable builder
       * would let the count clause leak into the page query and vice versa.
       * Filters, joins and ordering carry over; only what is selected is reset.
       */
      clearSelect() {
        return selectBuilder(tableRef, {
          ...state,
          joins: [...state.joins],
          predicates: [...state.predicates],
          orderBy: [...state.orderBy],
          projection: null,
          aggregates: [],
          selectAll: false,
        });
      },
      distinctOn() {
        return builder;
      },
      where(columnOrCallback, op, value) {
        if (typeof columnOrCallback === 'function') {
          state.predicates.push(columnOrCallback(makeExpressionBuilder()));
        } else {
          state.predicates.push({
            kind: 'cmp',
            column: columnOrCallback,
            op,
            value,
          });
        }
        return builder;
      },
      orderBy(column, direction = 'asc') {
        state.orderBy.push({ column, direction });
        return builder;
      },
      limit(n) {
        state.limit = n;
        return builder;
      },
      offset(n) {
        state.offset = n;
        return builder;
      },
      async execute() {
        const list = contexts();
        if (state.aggregates.length) {
          const out = {};
          for (const aggregate of state.aggregates) {
            out[aggregate.alias] = aggregate.compute(list);
          }
          return [out];
        }
        return list.map(project);
      },
      async executeTakeFirst() {
        const [first] = await builder.execute();
        return first;
      },
    };

    return builder;
  }

  const db = {
    selectFrom: selectBuilder,

    insertInto(table) {
      queryLog.push({ op: 'insert', table });
      let pending = [];
      let returning = false;
      /** @type {null | {columns: string[], doNothing: boolean, set: Object|null, where: Object[]}} */
      let conflict = null;

      const builder = {
        values(input) {
          pending = Array.isArray(input) ? input : [input];
          return builder;
        },
        /**
         * Model INSERT ... ON CONFLICT. Supports the two shapes the storage
         * layer uses: `.columns([...]).doNothing()` and
         * `.columns([...]).doUpdateSet({...}).where(cb)`. The optional WHERE on
         * the update branch matches the *existing* row (as PostgreSQL does), so
         * a suppressed update inserts/returns nothing.
         */
        onConflict(callback) {
          const oc = { columns: [], doNothing: false, set: null, where: [] };
          const ocBuilder = {
            columns(cols) {
              oc.columns = Array.isArray(cols) ? cols : [cols];
              return ocBuilder;
            },
            column(col) {
              oc.columns = [col];
              return ocBuilder;
            },
            doNothing() {
              oc.doNothing = true;
              return ocBuilder;
            },
            doUpdateSet(set) {
              oc.set = set;
              return ocBuilder;
            },
            where(columnOrCallback, op, value) {
              if (typeof columnOrCallback === 'function') {
                oc.where.push(columnOrCallback(makeExpressionBuilder()));
              } else {
                oc.where.push({
                  kind: 'cmp',
                  column: columnOrCallback,
                  op,
                  value,
                });
              }
              return ocBuilder;
            },
          };
          callback(ocBuilder);
          conflict = oc;
          return builder;
        },
        returningAll() {
          returning = true;
          return builder;
        },
        returning() {
          returning = true;
          return builder;
        },
        async execute() {
          const inserted = [];
          for (const value of pending) {
            if (conflict) {
              const existing = rowsOf(table).find((row) =>
                conflict.columns.every((c) => row[c] === value[c]),
              );
              if (existing) {
                if (conflict.doNothing) continue;
                // DO UPDATE, gated by the optional WHERE against the existing row.
                if (!conflict.where.every((p) => matches(existing, p)))
                  continue;
                const applied = parseJsonbColumns(
                  table,
                  resolveWriteValues(conflict.set || {}, existing),
                );
                Object.assign(existing, applied);
                if (returning) inserted.push(structuredClone(existing));
                continue;
              }
            }
            const row = parseJsonbColumns(
              table,
              resolveWriteValues({ id: crypto.randomUUID(), ...value }),
            );
            assertUnique(table, row);
            rowsOf(table).push(row);
            inserted.push(structuredClone(row));
          }
          return returning
            ? inserted
            : [{ numInsertedOrUpdatedRows: BigInt(inserted.length) }];
        },
        async executeTakeFirst() {
          const [first] = await builder.execute();
          return first;
        },
      };
      return builder;
    },

    updateTable(table) {
      queryLog.push({ op: 'update', table });
      const predicates = [];
      let updates = {};
      let returning = false;

      const builder = {
        // `.set()` also takes the callback form (`(eb) => ({ … })`) that the
        // share-link use counter uses. Resolving it here rather than treating
        // the function as a value is what keeps the increment from silently
        // compiling to an empty SET clause.
        set(input) {
          updates =
            typeof input === 'function'
              ? input(makeExpressionBuilder())
              : input;
          return builder;
        },
        where(columnOrCallback, op, value) {
          if (typeof columnOrCallback === 'function') {
            predicates.push(columnOrCallback(makeExpressionBuilder()));
          } else {
            predicates.push({
              kind: 'cmp',
              column: columnOrCallback,
              op,
              value,
            });
          }
          return builder;
        },
        returningAll() {
          returning = true;
          return builder;
        },
        async execute() {
          const targets = rowsOf(table).filter((row) =>
            predicates.every((p) => matches(row, p)),
          );
          for (const row of targets) {
            const applied = parseJsonbColumns(
              table,
              resolveWriteValues(updates, row),
            );
            assertUnique(table, { ...row, ...applied }, row);
            Object.assign(row, applied);
          }
          return returning
            ? targets.map((row) => structuredClone(row))
            : [{ numUpdatedRows: BigInt(targets.length) }];
        },
        async executeTakeFirst() {
          const [first] = await builder.execute();
          return first;
        },
      };
      return builder;
    },

    deleteFrom(table) {
      queryLog.push({ op: 'delete', table });
      const predicates = [];
      let returningColumns = null;

      const builder = {
        where(columnOrCallback, op, value) {
          if (typeof columnOrCallback === 'function') {
            predicates.push(columnOrCallback(makeExpressionBuilder()));
          } else {
            predicates.push({
              kind: 'cmp',
              column: columnOrCallback,
              op,
              value,
            });
          }
          return builder;
        },
        // `deleteFrom(...).returning('id').executeTakeFirst()` is how the
        // storage layer tells "deleted a row" from "matched nothing"
        // (organizations.js). Without it the double answered with the
        // delete-count shape and the caller read `undefined` as not_found.
        returning(columns) {
          returningColumns = Array.isArray(columns) ? columns : [columns];
          return builder;
        },
        async execute() {
          const rows = rowsOf(table);
          const gone = rows.filter((row) =>
            predicates.every((p) => matches(row, p)),
          );
          const keep = rows.filter(
            (row) => !predicates.every((p) => matches(row, p)),
          );
          tables[table] = keep;
          if (returningColumns) {
            return gone.map((row) =>
              Object.fromEntries(
                returningColumns.map((column) => [column, row[column]]),
              ),
            );
          }
          return [{ numDeletedRows: BigInt(rows.length - keep.length) }];
        },
        async executeTakeFirst() {
          const [first] = await builder.execute();
          return first;
        },
      };
      return builder;
    },

    /**
     * Model `db.transaction().execute(fn)`. The callback receives the same
     * double as `trx`, so every query shape above works inside a transaction
     * unchanged; on a thrown callback the tables are rolled back to the
     * snapshot taken on entry, exactly as PostgreSQL discards an aborted
     * transaction. The GDPR erasure path (view-sessions-gdpr.js) deletes
     * slide_views and view_sessions inside one transaction and depends on that
     * all-or-nothing behaviour.
     *
     * What this does NOT model — and cannot, being single-threaded — is
     * isolation between concurrent transactions: two overlapping erasures are
     * serialized here, never interleaved. Same limitation as the slide-lock
     * acquire-race double (tests/slide-lock-acquire-race.test.js); a test that
     * claimed to cover a genuine race on this double would be lying.
     */
    transaction() {
      return {
        async execute(fn) {
          const snapshot = {};
          for (const [name, rows] of Object.entries(tables)) {
            snapshot[name] = rows.map((row) => ({ ...row }));
          }
          try {
            return await fn(db);
          } catch (err) {
            for (const name of Object.keys(tables)) delete tables[name];
            for (const [name, rows] of Object.entries(snapshot))
              tables[name] = rows;
            throw err;
          }
        },
      };
    },

    fn: makeExpressionBuilder().fn,

    /** Direct access to the backing rows, for arrange/assert in tests. */
    __tables: tables,
    /** Every table touched, in order. Lets tests assert what was NOT queried. */
    __queryLog: queryLog,
  };

  return db;
}

/**
 * Convenience: tables touched by a given operation kind.
 * @param {Object} db - Double from createFakeDb
 * @param {string} [op] - Operation filter ('select', 'join', 'insert', ...)
 * @returns {string[]}
 */
export function touchedTables(db, op) {
  return db.__queryLog
    .filter((entry) => !op || entry.op === op)
    .map((entry) => entry.table);
}

export { UniqueViolationError };
