import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseJQL, examples } from "./analyser.js";

const AGGREGATE_FUNCTIONS = new Set(["sum", "avg", "count", "max", "min"]);
const SCALAR_FUNCTIONS = new Set(["length", "trimLeft", "trimRight"]);

const jsonCache = new Map();
const sourceRowsCache = new Map();
const pathStepsCache = new Map();

const LARGE_TIMESTAMP_THRESHOLD = 1e12;
const NUMERIC_PATTERN = /^-?\d+(?:\.\d+)?$/;
const DATE_PATTERN = /[-/:TZ ]|[A-Za-z]/;


function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDataFile(fileName, baseDir) {
  const candidates = [
    path.resolve(baseDir, "examples", fileName),
    path.resolve(baseDir, fileName)
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Не найден JSON-файл: ${fileName}`);
}

async function loadJsonRecord(filePath) {
  const stat = await fs.stat(filePath);
  const cached = jsonCache.get(filePath);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const content = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(content);
  const record = { data, mtimeMs: stat.mtimeMs, size: stat.size };
  jsonCache.set(filePath, record);
  return record;
}

function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

function toPathSteps(segments) {
  const cacheKey = JSON.stringify(segments || []);
  const cached = pathStepsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const steps = [];

  for (const segment of segments || []) {
    steps.push({ type: "prop", key: segment.key });

    for (const index of segment.indexes || []) {
      steps.push({ type: "index", index });
    }
  }

  pathStepsCache.set(cacheKey, steps);
  return steps;
}

function readBySteps(root, steps) {
  let cursor = root;

  for (const step of steps) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }

    if (step.type === "prop") {
      cursor = cursor[step.key];
      continue;
    }

    if (!Array.isArray(cursor)) {
      return undefined;
    }

    cursor = cursor[step.index];
  }

  return cursor;
}

function writeBySteps(target, steps, value) {
  if (!steps.length) {
    return;
  }

  let cursor = target;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const next = steps[i + 1];
    const last = i === steps.length - 1;

    if (step.type === "prop") {
      if (last) {
        cursor[step.key] = value;
        return;
      }

      if (!isObjectLike(cursor[step.key])) {
        cursor[step.key] = next && next.type === "index" ? [] : {};
      }

      cursor = cursor[step.key];
      continue;
    }

    if (!Array.isArray(cursor)) {
      return;
    }

    if (last) {
      cursor[step.index] = value;
      return;
    }

    if (!isObjectLike(cursor[step.index])) {
      cursor[step.index] = next && next.type === "index" ? [] : {};
    }

    cursor = cursor[step.index];
  }
}

function deleteBySteps(target, steps) {
  if (!steps.length) {
    return;
  }

  let cursor = target;

  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];

    if (step.type === "prop") {
      cursor = cursor?.[step.key];
    } else {
      cursor = Array.isArray(cursor) ? cursor[step.index] : undefined;
    }

    if (cursor === null || cursor === undefined) {
      return;
    }
  }

  const last = steps[steps.length - 1];

  if (last.type === "prop" && isObjectLike(cursor)) {
    delete cursor[last.key];
    return;
  }

  if (last.type === "index" && Array.isArray(cursor)) {
    delete cursor[last.index];
  }
}

function parseDate(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeComparable(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "number") {
    return Math.abs(value) < LARGE_TIMESTAMP_THRESHOLD ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (NUMERIC_PATTERN.test(trimmed)) {
      const numeric = Number(trimmed);
      return Math.abs(numeric) < LARGE_TIMESTAMP_THRESHOLD ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed) && DATE_PATTERN.test(trimmed)) {
      return parsed;
    }

    return trimmed;
  }

  return value;
}

function compareValues(left, right, operator) {
  if (operator === "after" || operator === "before") {
    const leftDate = parseDate(left);
    const rightDate = parseDate(right);

    if (leftDate === null || rightDate === null) {
      return false;
    }

    return operator === "after" ? leftDate > rightDate : leftDate < rightDate;
  }

  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);

  if (operator === "=" || operator === "!=") {
    const equal = normalizedLeft === normalizedRight;
    return operator === "=" ? equal : !equal;
  }

  const leftIsComparable = typeof normalizedLeft === "number" || typeof normalizedLeft === "string";
  const rightIsComparable = typeof normalizedRight === "number" || typeof normalizedRight === "string";

  if (!leftIsComparable || !rightIsComparable) {
    return false;
  }

  const comparisons = {
    ">": normalizedLeft > normalizedRight,
    "<": normalizedLeft < normalizedRight,
    ">=": normalizedLeft >= normalizedRight,
    "<=": normalizedLeft <= normalizedRight
  };

  return comparisons[operator] ?? false;
}

function makeRowContext(base, aliases = {}) {
  return {
    base,
    aliases: { ...aliases }
  };
}

function evaluateFieldPath(pathNode, rowCtx) {
  const segments = pathNode?.segments || [];
  if (!segments.length) {
    return undefined;
  }

  let cursor = rowCtx.base;
  let startIndex = 0;

  const firstSegment = segments[0];
  if (Object.prototype.hasOwnProperty.call(rowCtx.aliases, firstSegment.key)) {
    cursor = rowCtx.aliases[firstSegment.key];
    startIndex = 1;
  }

  for (let i = startIndex; i < segments.length; i++) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }

    const segment = segments[i];
    cursor = cursor[segment.key];

    for (const index of segment.indexes || []) {
      if (!Array.isArray(cursor)) {
        return undefined;
      }

      cursor = cursor[index];
    }
  }

  return cursor;
}

function evaluateBinaryExpression(node, rowCtx, scope) {
  const left = evaluateNode(node.left, rowCtx, {
    ...scope,
    topLevelAggregate: false
  });
  const right = evaluateNode(node.right, rowCtx, {
    ...scope,
    topLevelAggregate: false
  });

  const BINARY_OPERATORS = {
    "+": (l, r) => Number(l) + Number(r),
    "-": (l, r) => Number(l) - Number(r),
    "*": (l, r) => Number(l) * Number(r),
    "/": (l, r) => Number(l) / Number(r)
  };

  const operator = BINARY_OPERATORS[node.operator];
  return operator ? operator(left, right) : undefined;
}

function computeAggregateFunction(functionName, numericValues, definedValues) {
  switch (functionName) {
    case "count":
      return definedValues.length;
    case "sum":
      return numericValues.reduce((acc, value) => acc + value, 0);
    case "avg":
      return numericValues.length ? numericValues.reduce((acc, value) => acc + value, 0) / numericValues.length : 0;
    case "max":
      return numericValues.length ? Math.max(...numericValues) : undefined;
    case "min":
      return numericValues.length ? Math.min(...numericValues) : undefined;
    default:
      return undefined;
  }
}

function evaluateAggregateAcrossRows(functionName, argumentNodes, rowContexts, scope) {
  const values = [];

  for (const rowCtx of rowContexts) {
    for (const argNode of argumentNodes) {
      values.push(evaluateNode(argNode, rowCtx, {
        ...scope,
        topLevelAggregate: false
      }));
    }
  }

  const definedValues = values.filter(value => value !== null && value !== undefined);
  const numericValues = definedValues.map(Number).filter(value => !Number.isNaN(value));

  return computeAggregateFunction(functionName, numericValues, definedValues);
}

function evaluateScalarFunction(functionName, argumentNodes, rowCtx, scope) {
  const evaluatedArgs = argumentNodes.map(arg => evaluateNode(arg, rowCtx, scope));

  switch (functionName) {
    case "length": {
      const value = evaluatedArgs[0];
      return (typeof value === "string" || Array.isArray(value)) ? value.length : 0;
    }

    case "trimLeft": {
      const [pattern, value] = evaluatedArgs;
      if (typeof value !== "string" || typeof pattern !== "string" || !pattern.length) {
        return value;
      }
      let result = value;
      while (result.startsWith(pattern)) {
        result = result.slice(pattern.length);
      }
      return result;
    }

    case "trimRight": {
      const [pattern, value] = evaluatedArgs;
      if (typeof value !== "string" || typeof pattern !== "string" || !pattern.length) {
        return value;
      }
      let result = value;
      while (result.endsWith(pattern)) {
        result = result.slice(0, result.length - pattern.length);
      }
      return result;
    }

    default:
      return undefined;
  }
}

function evaluateFunctionCall(node, rowCtx, scope) {
  const functionName = node.function;
  const argumentNodes = node.arguments || [];

  if (AGGREGATE_FUNCTIONS.has(functionName)) {
    const rowContexts = scope.rowContexts && scope.rowContexts.length ? scope.rowContexts : [rowCtx];
    const shouldAggregateAcrossRows = scope.topLevelAggregate === true && rowContexts.length > 0;

    if (shouldAggregateAcrossRows) {
      return evaluateAggregateAcrossRows(functionName, argumentNodes, rowContexts, scope);
    }

    const evaluatedArgs = argumentNodes.map(arg => evaluateNode(arg, rowCtx, {
      ...scope,
      selectMode: "row",
      topLevelAggregate: false
    }));
    const definedValues = evaluatedArgs.filter(value => value !== null && value !== undefined);
    const numericValues = definedValues.map(Number).filter(value => !Number.isNaN(value));

    return computeAggregateFunction(functionName, numericValues, definedValues);
  }

  if (SCALAR_FUNCTIONS.has(functionName)) {
    return evaluateScalarFunction(functionName, argumentNodes, rowCtx, scope);
  }

  throw new Error(`Неизвестная функция: ${functionName}`);
}

function evaluateNode(node, rowCtx, scope) {
  if (node === null || node === undefined) {
    return undefined;
  }

  if (node.type === "FieldPath") {
    return evaluateFieldPath(node, rowCtx, scope);
  }

  if (node.type === "FunctionCall") {
    return evaluateFunctionCall(node, rowCtx, scope);
  }

  if (node.type === "BinaryExpression") {
    return evaluateBinaryExpression(node, rowCtx, scope);
  }

  if (node.type === "NumberLiteral") {
    return node.value;
  }

  if (node.type === "StringLiteral") {
    return node.value;
  }

  if (typeof node === "number" || typeof node === "string" || typeof node === "boolean") {
    return node;
  }

  return undefined;
}

function evaluateCondition(node, rowCtx, scope) {
  if (!node) {
    return true;
  }

  if (node.type === "LogicalExpression") {
    const operator = node.operator;
    const left = evaluateCondition(node.left, rowCtx, scope);

    if (operator === "and" && !left) return false;
    if (operator === "or" && left) return true;

    const right = evaluateCondition(node.right, rowCtx, scope);
    return operator === "and" ? left && right : left || right;
  }

  if (node.type === "ComparisonExpression") {
    const left = evaluateNode(node.left, rowCtx, scope);
    const right = evaluateNode(node.right, rowCtx, scope);
    return compareValues(left, right, node.operator);
  }

  if (node.type === "BetweenExpression") {
    const value = evaluateNode(node.value, rowCtx, scope);
    const lower = evaluateNode(node.lower, rowCtx, scope);
    const upper = evaluateNode(node.upper, rowCtx, scope);

    const valueDate = parseDate(value);
    const lowerDate = parseDate(lower);
    const upperDate = parseDate(upper);

    if (valueDate !== null && lowerDate !== null && upperDate !== null) {
      return valueDate >= lowerDate && valueDate <= upperDate;
    }

    return compareValues(value, lower, ">=") && compareValues(value, upper, "<=");
  }

  return Boolean(evaluateNode(node, rowCtx, scope));
}

async function loadSourceRows(sourceRef, baseDir) {
  const filePath = await resolveDataFile(sourceRef.file, baseDir);
  const jsonRecord = await loadJsonRecord(filePath);
  const sourcePathKey = JSON.stringify(sourceRef.sourcePath?.segments || []);
  const cacheKey = `${filePath}::${jsonRecord.mtimeMs}::${sourcePathKey}`;
  const cachedRows = sourceRowsCache.get(cacheKey);

  if (cachedRows) {
    return cachedRows;
  }

  const raw = jsonRecord.data;
  const sourceSteps = toPathSteps(sourceRef.sourcePath?.segments || []);

  const sourceData = sourceSteps.length ? readBySteps(raw, sourceSteps) : raw;
  const itemsArray = Array.isArray(sourceData) ? sourceData : [sourceData];

  const rows = itemsArray.map(item => makeRowContext(item));

  sourceRowsCache.set(cacheKey, rows);
  return rows;
}

function bindAlias(rows, aliasName) {
  if (!aliasName) {
    return rows;
  }

  return rows.map(rowCtx => makeRowContext(rowCtx.base, { ...rowCtx.aliases, [aliasName]: rowCtx.base }));
}

function combineRowContexts(leftRow, rightRow, joinAlias) {
  const aliases = {
    ...leftRow.aliases,
    ...rightRow.aliases
  };

  if (joinAlias) {
    aliases[joinAlias] = rightRow.base;
  }

  return makeRowContext(leftRow.base, aliases);
}

async function applyJoinClause(rowContexts, joinClause, baseDir) {
  const rightRows = await loadSourceRows(
    { file: joinClause.file, sourcePath: joinClause.sourcePath },
    baseDir
  );
  const aliasedRightRows = bindAlias(rightRows, joinClause.alias);
  const joinType = joinClause.joinType || "outer";

  const results = [];
  const matchedRightIndexes = new Set();

  for (let leftIndex = 0; leftIndex < rowContexts.length; leftIndex++) {
    const leftRow = rowContexts[leftIndex];
    let hasMatch = false;

    for (let rightIndex = 0; rightIndex < aliasedRightRows.length; rightIndex++) {
      const rightRow = aliasedRightRows[rightIndex];
      const combined = combineRowContexts(leftRow, rightRow, joinClause.alias);

      if (evaluateCondition(joinClause.condition, combined, { selectMode: "list", rowContexts })) {
        hasMatch = true;
        matchedRightIndexes.add(rightIndex);
        results.push(combined);
      }
    }

    if (!hasMatch && (joinType === "left" || joinType === "outer")) {
      const nullAliases = joinClause.alias ? { [joinClause.alias]: null } : {};
      results.push(makeRowContext(leftRow.base, { ...leftRow.aliases, ...nullAliases }));
    }
  }

  if (joinType === "right" || joinType === "outer") {
    for (let rightIndex = 0; rightIndex < aliasedRightRows.length; rightIndex++) {
      if (matchedRightIndexes.has(rightIndex)) {
        continue;
      }

      const rightRow = aliasedRightRows[rightIndex];
      const aliases = { ...rightRow.aliases };
      if (joinClause.alias) {
        aliases[joinClause.alias] = rightRow.base;
      }
      results.push(makeRowContext(rightRow.base, aliases));
    }
  }

  return results;
}

function projectSelectedFields(rowCtx, fieldList, groupRows = null) {
  const activeRowContexts = groupRows && groupRows.length ? groupRows : [rowCtx];
  const scope = {
    selectMode: "list",
    rowContexts: activeRowContexts,
    groupRows: groupRows && groupRows.length ? groupRows : null,
    topLevelAggregate: !!(groupRows && groupRows.length)
  };

  if (fieldList.exclude) {
    const result = cloneValue(rowCtx.base);
    if (!isObjectLike(result)) {
      return result;
    }

    for (const field of fieldList.fields) {
      const steps = field.type === "FieldPath"
        ? toPathSteps(field.segments)
        : field.type === "FieldWithAlias" && field.value?.type === "FieldPath"
        ? toPathSteps(field.value.segments)
        : [];

      if (steps.length) {
        deleteBySteps(result, steps);
      }
    }

    return result;
  }

  const result = {};

  fieldList.fields.forEach((field, index) => {
    if (field.type === "FieldWithAlias") {
      result[field.alias] = evaluateNode(field.value, rowCtx, scope);
      return;
    }

    if (field.type === "FieldPath") {
      const value = evaluateNode(field, rowCtx, scope);
      writeBySteps(result, toPathSteps(field.segments || []), value);
      return;
    }

    result[`value_${index + 1}`] = evaluateNode(field, rowCtx, scope);
  });

  return result;
}

function evaluateAggregateSelection(rowContexts, aggregateFieldList, scope) {
  const result = {};

  for (const field of aggregateFieldList.fields) {
    result[field.alias] = evaluateNode(field.value, rowContexts[0] ?? makeRowContext(undefined), {
      selectMode: "aggregate",
      topLevelAggregate: true,
      rowContexts,
      ...scope
    });
  }

  return result;
}

function groupRowContexts(rowContexts, groupByClause, scope) {
  if (!groupByClause || !groupByClause.fields || !groupByClause.fields.length) {
    return [];
  }

  const groups = new Map();

  for (const rowCtx of rowContexts) {
    const groupValues = groupByClause.fields.map(field => evaluateNode(field, rowCtx, {
      ...scope,
      rowContexts: [rowCtx],
      topLevelAggregate: false
    }));
    const cacheKey = JSON.stringify(groupValues.map(value => value === undefined ? null : value));
    const group = groups.get(cacheKey);

    if (group) {
      group.rowContexts.push(rowCtx);
      continue;
    }

    groups.set(cacheKey, {
      key: groupValues,
      representative: rowCtx,
      rowContexts: [rowCtx]
    });
  }

  return Array.from(groups.values());
}

export class JQLCompiler {
  constructor({ baseDir = process.cwd() } = {}) {
    this.baseDir = baseDir;
  }

  async compile(queryAst) {
    return async () => this.executeAst(queryAst);
  }

  async executeAst(queryAst) {
    if (!queryAst || queryAst.type !== "Query") {
      throw new Error("Ожидалось AST типа Query");
    }

    const source = queryAst.from;
    if (!source) {
      throw new Error("Запрос без FROM не поддержан компилятором");
    }

    let rowContexts = await loadSourceRows(source, this.baseDir);
    rowContexts = bindAlias(rowContexts, source.alias);

    for (const aliasSection of source.aliases || []) {
      void aliasSection;
    }

    for (const joinClause of source.joins || []) {
      rowContexts = await applyJoinClause(rowContexts, joinClause, this.baseDir);
    }

    if (queryAst.where) {
      rowContexts = rowContexts.filter(rowCtx => evaluateCondition(queryAst.where.condition, rowCtx, {
        selectMode: queryAst.select.mode,
        rowContexts
      }));
    }

    if (queryAst.groupBy) {
      const groups = groupRowContexts(rowContexts, queryAst.groupBy, {
        selectMode: queryAst.select.mode
      });

      if (queryAst.select.mode === "aggregate") {
        return groups.map(group => evaluateAggregateSelection(group.rowContexts, queryAst.select.selection, {
          baseDir: this.baseDir
        }));
      }

      const fieldList = queryAst.select.selection;
      return groups.map(group => projectSelectedFields(group.representative, fieldList, group.rowContexts));
    }

    if (queryAst.select.mode === "aggregate") {
      return evaluateAggregateSelection(rowContexts, queryAst.select.selection, {
        baseDir: this.baseDir
      });
    }

    const fieldList = queryAst.select.selection;
    return rowContexts.map(rowCtx => projectSelectedFields(rowCtx, fieldList));
  }
}

export async function compileAndExecute(query, options = {}) {
  const ast = typeof query === "string" ? parseJQL(query) : query;
  const compiler = new JQLCompiler(options);
  const executable = await compiler.compile(ast);
  return executable();
}

async function runInteractiveShell(options = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const compilerOptions = { baseDir: options.baseDir ?? process.cwd() };

  console.log("JQL Console. Введите запрос или 'exit' для выхода.");

  try {
    while (true) {
      const rawInput = await rl.question("jql> ").catch(error => {
        if (error?.code === "ERR_USE_AFTER_CLOSE" || error?.code === "ERR_STREAM_DESTROYED") {
          return null;
        }
        throw error;
      });

      if (rawInput === null) {
        break;
      }

      const input = rawInput.trim();

      if (!input) {
        continue;
      }

      if (input === "exit" || input === ":q" || input === "quit") {
        break;
      }

      try {
        const result = await compileAndExecute(input, compilerOptions);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    rl.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const isRepl = process.argv.includes("--repl") || process.argv.includes("-i");

if (isMain) {
  if (isRepl) {
    await runInteractiveShell();
  } else {
    let success = true;

    for (const query of examples) {
      try {
        const result = await compileAndExecute(query);

        console.log(`Запрос: ${query}`);
        console.log('Результат:');
        console.log(JSON.stringify(result, null, 2));
        console.log("\n" + "=".repeat(50) + "\n");
      } catch (error) {
        success = false;
        console.error(`Ошибка в запросе: ${query}`);
        console.error(error.message);
        console.log("\n" + "=".repeat(50) + "\n");
      }
    }

    console.log(success ? "Все запросы успешно выполнены!" : "Есть запросы, которые не удалось выполнить.");
  }
}
