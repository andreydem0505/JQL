import {JQLParser, JQLLexer} from "./parser.js";

const parserInstance = new JQLParser();

const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor();

class JQLToAstVisitor extends BaseCstVisitor {
  constructor() {
    super();
    this.aliasMap = new Map();
    this.validateVisitor();
  }

  query(ctx) {
    this.aliasMap.clear();
    const from = ctx.fromClause ? this.visit(ctx.fromClause) : null;

    return {
      type: "Query",
      select: this.visit(ctx.selectClause),
      from: from,
      where: ctx.whereClause ? this.visit(ctx.whereClause) : null
    };
  }

  selectClause(ctx) {
    if (ctx.fieldList) {
      return {
        type: "SelectClause",
        mode: "list",
        selection: this.visit(ctx.fieldList)
      };
    }

    return {
      type: "SelectClause",
      mode: "aggregate",
      selection: this.visit(ctx.aggregateFieldList)
    };
  }

  fieldList(ctx) {
    return {
      type: "FieldList",
      exclude: ctx.Minus !== undefined,
      fields: this.visit(ctx.fields)
    };
  }

  aggregateFieldList(ctx) {
    return {
      type: "AggregateFieldList",
      fields: ctx.aggregateField.map(fieldCtx => this.visit(fieldCtx))
    };
  }

  aggregateField(ctx) {
    return {
      type: "AggregateField",
      alias: ctx.alias[0].image,
      value: this.visit(ctx.functionCall)
    };
  }

  fields(ctx) {
    return ctx.field.map(fieldCtx => this.visit(fieldCtx));
  }

  field(ctx) {
    const alias = ctx.alias ? ctx.alias[0].image : null;

    let value;
    if (ctx.functionCall) {
      value = this.visit(ctx.functionCall);
    } else if (ctx.expression) {
      value = this.visit(ctx.expression);
    } else {
      value = this.visit(ctx.fieldPath);
    }

    if (alias) {
      return {
        type: "FieldWithAlias",
        alias: alias,
        value: value
      };
    }

    return value;
  }

  fieldPath(ctx) {
    const parts = ctx.pathPart.map(partCtx => this.visit(partCtx));
    const resolvedSegments = [];

    for (const part of parts) {
      if (!part.isAlias) {
        resolvedSegments.push(part.segment);
        continue;
      }

      const aliasName = part.segment.key;
      const aliasTarget = this.aliasMap.get(aliasName);

      if (!aliasTarget) {
        throw new Error(`Неизвестный alias: ${aliasName}`);
      }

      const clonedAliasSegments = aliasTarget.segments.map(segment => ({
        type: "PathSegment",
        key: segment.key,
        indexes: [...segment.indexes]
      }));

      if (part.segment.indexes.length > 0 && clonedAliasSegments.length > 0) {
        const last = clonedAliasSegments[clonedAliasSegments.length - 1];
        last.indexes.push(...part.segment.indexes);
      }

      resolvedSegments.push(...clonedAliasSegments);
    }

    return {
      type: "FieldPath",
      segments: resolvedSegments
    };
  }

  pathPart(ctx) {
    return {
      isAlias: !!ctx.Dollar,
      segment: this.visit(ctx.pathSegment)
    };
  }

  pathSegment(ctx) {
    return {
      type: "PathSegment",
      key: ctx.Identifier[0].image,
      indexes: ctx.segmentIndex ? ctx.segmentIndex.map(indexCtx => this.visit(indexCtx)) : []
    };
  }

  segmentIndex(ctx) {
    return Number(ctx.NumberLiteral[0].image);
  }

  functionCall(ctx) {
    return {
      type: "FunctionCall",
      function: this.visit(ctx.functionName),
      arguments: this.visit(ctx.functionArgs)
    };
  }

  functionName(ctx) {
    if (ctx.Sum) {
      return "sum";
    } else if (ctx.Avg) {
      return "avg";
    } else if (ctx.Count) {
      return "count";
    } else if (ctx.Max) {
      return "max";
    } else if (ctx.Min) {
      return "min";
    } else if (ctx.Length) {
      return "length";
    }  else if (ctx.TrimLeft) {
      return "trimLeft";
    } else if (ctx.TrimRight) {
      return "trimRight";
    }
  }

  functionArgs(ctx) {
    return ctx.arg.map(argCtx => this.visit(argCtx));
  }

  functionArgument(ctx) {
    if (ctx.StringLiteral) {
      const value = ctx.StringLiteral[0].image;
      return {
        type: "StringLiteral",
        value: value.substring(1, value.length - 1)
      };
    }

    return this.visit(ctx.expression);
  }

  expression(ctx) {
    return this.visit(ctx.additionExpression);
  }

  additionExpression(ctx) {
    let result = this.visit(ctx.lhs[0]);

    if (ctx.rhs) {
      for (let i = 0; i < ctx.rhs.length; i++) {
        const operator = ctx.Plus && ctx.Plus[i] ? '+' : '-';
        const right = this.visit(ctx.rhs[i]);

        result = {
          type: "BinaryExpression",
          operator: operator,
          left: result,
          right: right
        };
      }
    }

    return result;
  }

  multiplicationExpression(ctx) {
    let result = this.visit(ctx.lhs[0]);

    if (ctx.rhs) {
      for (let i = 0; i < ctx.rhs.length; i++) {
        const operator = ctx.Star && ctx.Star[i] ? '*' : '/';
        const right = this.visit(ctx.rhs[i]);

        result = {
          type: "BinaryExpression",
          operator: operator,
          left: result,
          right: right
        };
      }
    }

    return result;
  }

  atomicExpression(ctx) {
    if (ctx.functionCall) {
      return this.visit(ctx.functionCall);
    }

    if (ctx.fieldPath) {
      return this.visit(ctx.fieldPath);
    }

    if (ctx.NumberLiteral) {
      return {
        type: "NumberLiteral",
        value: Number(ctx.NumberLiteral[0].image)
      };
    }

    if (ctx.expression) {
      return this.visit(ctx.expression);
    }
  }

  sourceRef(ctx) {
    const filePath = ctx.StringLiteral[0].image;
    const cleanPath = filePath.substring(1, filePath.length - 1);

    return {
      type: "SourceRef",
      file: cleanPath,
      sourcePath: ctx.sourcePath ? this.visit(ctx.sourcePath[0]) : null
    };
  }

  aliasMapping(ctx) {
    return {
      alias: ctx.aliasName[0].image,
      path: this.visit(ctx.aliasSource[0])
    };
  }

  legacyAliasSection(ctx) {
    const aliases = ctx.aliasMapping ? ctx.aliasMapping.map(aliasCtx => this.visit(aliasCtx)) : [];

    return {
      type: "LegacyAliasSection",
      aliases: aliases
    };
  }

  joinClause(ctx) {
    const source = this.visit(ctx.source[0]);
    const joinType = ctx.Left ? "left" : ctx.Right ? "right" : ctx.Inner ? "inner" : "inner";
    const alias = ctx.joinAlias ? ctx.joinAlias[0].image : null;

    if (alias) {
      const aliasTarget = source.sourcePath || { type: "FieldPath", segments: [] };
      this.aliasMap.set(alias, aliasTarget);
    }

    return {
      type: "JoinClause",
      joinType: joinType,
      file: source.file,
      sourcePath: source.sourcePath,
      alias: alias,
      condition: this.visit(ctx.condition)
    };
  }

  fromClause(ctx) {
    const source = this.visit(ctx.source[0]);
    const sourceAlias = ctx.sourceAlias ? ctx.sourceAlias[0].image : null;

    if (sourceAlias) {
      const aliasTarget = source.sourcePath || { type: "FieldPath", segments: [] };
      this.aliasMap.set(sourceAlias, aliasTarget);
    }

    const aliases = [];
    if (ctx.legacyAliasSection) {
      for (const aliasSectionCtx of ctx.legacyAliasSection) {
        const aliasSection = this.visit(aliasSectionCtx);
        aliases.push(...aliasSection.aliases);

        for (const alias of aliasSection.aliases) {
          this.aliasMap.set(alias.alias, alias.path);
        }
      }
    }

    const joins = ctx.joinClause ? ctx.joinClause.map(joinCtx => this.visit(joinCtx)) : [];

    return {
      type: "FromClause",
      file: source.file,
      sourcePath: source.sourcePath,
      alias: sourceAlias,
      aliases: aliases,
      joins: joins
    };
  }

  whereClause(ctx) {
    return {
      type: "WhereClause",
      condition: this.visit(ctx.orCondition)
    };
  }

  orCondition(ctx) {
    let result = this.visit(ctx.lhs[0]);

    if (ctx.rhs) {
      for (let i = 0; i < ctx.rhs.length; i++) {
        result = {
          type: "LogicalExpression",
          operator: "or",
          left: result,
          right: this.visit(ctx.rhs[i])
        };
      }
    }

    return result;
  }

  andCondition(ctx) {
    let result = this.visit(ctx.lhs[0]);

    if (ctx.rhs) {
      for (let i = 0; i < ctx.rhs.length; i++) {
        result = {
          type: "LogicalExpression",
          operator: "and",
          left: result,
          right: this.visit(ctx.rhs[i])
        };
      }
    }

    return result;
  }

  whereFactor(ctx) {
    if (ctx.comparisonCondition) {
      return this.visit(ctx.comparisonCondition);
    }

    return this.visit(ctx.orCondition);
  }

  comparisonCondition(ctx) {
    if (ctx.Between) {
      return {
        type: "BetweenExpression",
        value: this.visit(ctx.left[0]),
        lower: this.visit(ctx.lower[0]),
        upper: this.visit(ctx.upper[0])
      };
    }

    return {
      type: "ComparisonExpression",
      operator: this.visit(ctx.comparisonOperator),
      left: this.visit(ctx.left[0]),
      right: this.visit(ctx.right[0])
    };
  }

  comparisonOperator(ctx) {
    if (ctx.Gte) return ">=";
    if (ctx.Lte) return "<=";
    if (ctx.Neq) return "!=";
    if (ctx.Gt) return ">";
    if (ctx.Lt) return "<";
    if (ctx.After) return "after";
    if (ctx.Before) return "before";
    return "=";
  }

  whereOperand(ctx) {
    if (ctx.fieldPath) {
      return this.visit(ctx.fieldPath);
    }

    if (ctx.NumberLiteral) {
      return {
        type: "NumberLiteral",
        value: Number(ctx.NumberLiteral[0].image)
      };
    }

    const value = ctx.StringLiteral[0].image;
    return {
      type: "StringLiteral",
      value: value.substring(1, value.length - 1)
    };
  }
}


function parseJQL(inputText) {
  // Лексический анализ
  const lexingResult = JQLLexer.tokenize(inputText);

  if (lexingResult.errors.length > 0) {
    console.error("Ошибки лексического анализа:");
    lexingResult.errors.forEach(error => console.error(error.message));
    return null;
  }

  // Синтаксический анализ
  parserInstance.input = lexingResult.tokens;
  const cst = parserInstance.query();

  if (parserInstance.errors.length > 0) {
    console.error("Ошибки синтаксического анализа:");
    parserInstance.errors.forEach(error => console.error(error.message));
    return null;
  }

  // Преобразование CST в AST
  const astVisitor = new JQLToAstVisitor();
  return astVisitor.visit(cst);
}


const examples = [
  "select [age, name] from 'input.json'",
  "select [имя_пользователя, возраст] from 'input.json'",
  "select -[age, name] from 'input.json'",
  "select [settings.theme.color, name] from 'input.json'",
  "select [new_age_key: age, new_name_key: name, profile] from 'input.json'",
  "select [s: sum(a, b, c), average: avg(a, b)] from 'input.json'",
  "select [s: a + b + c] from 'input.json'[result.success]",
  "select [d: a - b] from 'input.json'",
  "select [m: a * b] from 'input.json'",
  "select [d: a / b] from 'input.json'",
  "select [result: (a + b) * c] from 'input.json'",
  "select [trimedLeft: trimLeft('http://', url), trimedRight: trimRight('.com', url)] from 'input.json'",
  "select [subscribers_number: length($user.subscribers), name_length: length($user.$name)] from 'input.json' alias users[3] as user, profile.name as name",
  "select total_sum: sum(a, b), total_avg: avg(c, d), e_number: count(e) from 'input.json'",
  "select max_salary: max(salary), min_salary: min(salary) from 'input.json'",
  "select [a, b] where a > 5 and (b < 10 or d = 'value') from 'input.json'",
  "select sum_a: sum(a) where c != 4 from 'input.json'",
  "select s: sum(a * avg(b, c)) from 'input.json'",
  "select [students.name, faculties.name] from 'input.json'[students] as students left join 'input.json'[faculties] as faculties on students.facultyID = faculties.ID",
  "select [students.name, faculties.name] from 'input.json'[students] as students right join 'input.json'[faculties] as faculties on students.facultyID = faculties.ID",
  "select [students.name, faculties.name, teachers.name] from 'students.json' as students inner join 'faculties.json' as faculties on students.facultyID = faculties.ID inner join 'teachers.json' as teachers on students.teacherID = teachers.ID",
  "select [students.name, faculties.name] from 'input1.json'[students] as students join 'input2.json'[faculties] as faculties on students.facultyID = faculties.ID",
  "select [birthday] from 'input.json' where birthday after '2015-03-25T12:00:00Z'",
  "select [birthday] from 'input.json' where birthday before 1549312452",
  "select [birthday] from 'input.json' where birthday between startDate and endDate",
  "select [birthday] from 'input.json' where birthday between 'Jan 25 2015' and '03/16/2015'"
];

let success = true;

examples.forEach((query, _) => {
  console.log(`Запрос: ${query}`);
  console.log("AST:");
  const ast = parseJQL(query);
  if (!ast || !ast.hasOwnProperty('type') || ast.type !== 'Query') {
    success = false;
  }
  console.log(JSON.stringify(ast, null, 2));
  console.log("\n" + "=".repeat(50) + "\n");
});

console.log(success ? "Все запросы успешно распарсены!" : "Некоторые запросы не были распарсены.");
