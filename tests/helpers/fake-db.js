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
 *   where / orderBy / limit / offset / execute / executeTakeFirst,
 *   insertInto / values / returningAll / onConflict-free inserts,
 *   updateTable / set, deleteFrom, and `db.fn.count()`.
 *
 * Two behaviours are modelled on purpose because tests depend on them:
 *   1. UNIQUE constraints (notably the globally unique `users.email`) throw the
 *      way PostgreSQL does, so a code path that wrongly tries to insert a
 *      second row for an existing person fails loudly in tests.
 *   2. Every table touched is recorded in `db.__queryLog`, so a test can assert
 *      that single-workspace mode issues no membership lookups at all.
 */

import crypto from 'node:crypto';

/**
 * UNIQUE constraints enforced by the double, mirroring the migrations.
 * `users.email` is globally unique since 001_initial_schema.js:28; the
 * membership pair comes from 031_user_organizations.js.
 */
const UNIQUE_CONSTRAINTS = {
  users: [['email']],
  user_organizations: [['user_id', 'organization_id']],
  organizations: [['slug']],
};

/**
 * jsonb columns. The storage layer writes them via the `jsonb()` helper, which
 * hands the driver a JSON string; PostgreSQL stores it as jsonb and reads it
 * back as a parsed value. The double reproduces that round-trip so tests see
 * objects on read, exactly like production.
 */
const JSONB_COLUMNS = {
  users: ['settings'],
  organizations: ['settings'],
  app_settings: ['supported_slide_langs', 'webhooks'],
  auth_audit_log: ['metadata'],
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

/** Error shaped like a pg unique violation, so callers can recognise it. */
class UniqueViolationError extends Error {
  constructor(table, columns, value) {
    super(
      `duplicate key value violates unique constraint "${table}_${columns.join('_')}_key" ` +
        `(${columns.join(', ')})=(${value})`
    );
    this.name = 'UniqueViolationError';
    this.code = '23505';
    this.table = table;
    this.columns = columns;
  }
}

const lastSegment = (column) => String(column).split('.').pop();

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
      return right === null ? left === null || left === undefined : left === right;
    case 'is not':
      return right === null ? left !== null && left !== undefined : left !== right;
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
        op === 'ilike' ? 'i' : ''
      );
      return rx.test(haystack);
    }
    default:
      throw new Error(`fake-db: unsupported operator "${op}"`);
  }
}

/** Build the expression-builder callbacks accept (`eb`, `eb.or`, `eb.and`). */
function makeExpressionBuilder() {
  const eb = (column, op, value) => ({ kind: 'cmp', column, op, value });
  eb.or = (predicates) => ({ kind: 'or', predicates });
  eb.and = (predicates) => ({ kind: 'and', predicates });
  return eb;
}

/**
 * @param {Object} row - Row context
 * @param {Object} predicate - Predicate tree
 * @returns {boolean}
 */
function matches(row, predicate) {
  if (predicate.kind === 'cmp') {
    return compare(readColumn(row, predicate.column), predicate.op, predicate.value);
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
      if (columns.some((c) => candidate[c] === undefined || candidate[c] === null)) continue;
      const clash = rowsOf(table).find(
        (row) => row !== ignoreRow && columns.every((c) => row[c] === candidate[c])
      );
      if (clash) {
        throw new UniqueViolationError(table, columns, columns.map((c) => candidate[c]).join(', '));
      }
    }
  };

  /**
   * Shared filter/projection machinery for SELECT builders.
   * @param {string} table - Base table
   * @returns {Object}
   */
  function selectBuilder(table) {
    queryLog.push({ op: 'select', table });

    const state = {
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
        __source: { [table]: row },
        ...mergeIntoContext({}, table, row),
      }));

      for (const join of state.joins) {
        queryLog.push({ op: 'join', table: join.table });
        const joined = [];
        for (const context of list) {
          const partner = rowsOf(join.table).find(
            (row) =>
              mergeIntoContext(context, join.table, row)[join.left] ===
              mergeIntoContext(context, join.table, row)[join.right]
          );
          if (partner) {
            joined.push({
              ...mergeIntoContext(context, join.table, partner),
              __source: { ...context.__source, [join.table]: partner },
            });
          } else if (join.type === 'left') {
            joined.push(context);
          }
        }
        list = joined;
      }

      list = list.filter((context) =>
        state.predicates.every((predicate) => matches(context, predicate))
      );

      for (const { column, direction } of [...state.orderBy].reverse()) {
        list.sort((a, b) => {
          const left = readColumn(a, column);
          const right = readColumn(b, column);
          if (left === right) return 0;
          const cmp = left > right ? 1 : -1;
          return direction === 'desc' ? -cmp : cmp;
        });
      }

      if (state.offset) list = list.slice(state.offset);
      if (state.limit !== null) list = list.slice(0, state.limit);
      return list;
    };

    const project = (context) => {
      if (state.aggregates.length) return null;
      if (state.selectAll || !state.projection) {
        const out = {};
        for (const [key, value] of Object.entries(context)) {
          if (key === '__source' || key.includes('.')) continue;
          out[key] = value;
        }
        return out;
      }
      const out = {};
      for (const item of state.projection) {
        out[item.alias] = readColumn(context, item.column);
      }
      return out;
    };

    const builder = {
      innerJoin(joinTable, left, right) {
        state.joins.push({ table: joinTable, left, right, type: 'inner' });
        return builder;
      },
      leftJoin(joinTable, left, right) {
        state.joins.push({ table: joinTable, left, right, type: 'left' });
        return builder;
      },
      select(columns) {
        const list = Array.isArray(columns) ? columns : [columns];
        state.projection = state.projection || [];
        for (const entry of list) {
          if (entry && typeof entry === 'object' && entry.__aggregate) {
            state.aggregates.push(entry);
            continue;
          }
          const [column, , alias] = String(entry).split(/\s+/);
          state.projection.push({ column, alias: alias || lastSegment(column) });
        }
        return builder;
      },
      selectAll() {
        state.selectAll = true;
        return builder;
      },
      distinctOn() {
        return builder;
      },
      where(columnOrCallback, op, value) {
        if (typeof columnOrCallback === 'function') {
          state.predicates.push(columnOrCallback(makeExpressionBuilder()));
        } else {
          state.predicates.push({ kind: 'cmp', column: columnOrCallback, op, value });
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

      const builder = {
        values(input) {
          pending = Array.isArray(input) ? input : [input];
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
            const row = parseJsonbColumns(table, { id: crypto.randomUUID(), ...value });
            assertUnique(table, row);
            rowsOf(table).push(row);
            inserted.push({ ...row });
          }
          return returning ? inserted : [{ numInsertedOrUpdatedRows: BigInt(inserted.length) }];
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
        set(input) {
          updates = input;
          return builder;
        },
        where(columnOrCallback, op, value) {
          if (typeof columnOrCallback === 'function') {
            predicates.push(columnOrCallback(makeExpressionBuilder()));
          } else {
            predicates.push({ kind: 'cmp', column: columnOrCallback, op, value });
          }
          return builder;
        },
        returningAll() {
          returning = true;
          return builder;
        },
        async execute() {
          const targets = rowsOf(table).filter((row) => predicates.every((p) => matches(row, p)));
          const applied = parseJsonbColumns(table, updates);
          for (const row of targets) {
            assertUnique(table, { ...row, ...applied }, row);
            Object.assign(row, applied);
          }
          return returning
            ? targets.map((row) => ({ ...row }))
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

      const builder = {
        where(columnOrCallback, op, value) {
          if (typeof columnOrCallback === 'function') {
            predicates.push(columnOrCallback(makeExpressionBuilder()));
          } else {
            predicates.push({ kind: 'cmp', column: columnOrCallback, op, value });
          }
          return builder;
        },
        async execute() {
          const rows = rowsOf(table);
          const keep = rows.filter((row) => !predicates.every((p) => matches(row, p)));
          const removed = rows.length - keep.length;
          tables[table] = keep;
          return [{ numDeletedRows: BigInt(removed) }];
        },
        async executeTakeFirst() {
          const [first] = await builder.execute();
          return first;
        },
      };
      return builder;
    },

    fn: {
      count(column) {
        const aggregate = {
          __aggregate: true,
          alias: 'count',
          compute: (list) =>
            list.filter((context) => readColumn(context, column) !== undefined).length,
        };
        aggregate.as = (alias) => ({ ...aggregate, alias });
        return aggregate;
      },
    },

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
  return db.__queryLog.filter((entry) => !op || entry.op === op).map((entry) => entry.table);
}

export { UniqueViolationError };
