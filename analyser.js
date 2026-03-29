import {JQLParser, JQLLexer} from "./parser.js";

const parserInstance = new JQLParser();

const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor();

class JQLToAstVisitor extends BaseCstVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  query(ctx) {
    return {
      type: "Query",
      select: this.visit(ctx.selectClause),
      from: ctx.fromClause ? this.visit(ctx.fromClause) : null,
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
    return {
      type: "FieldPath",
      segments: ctx.pathSegment.map(segmentCtx => this.visit(segmentCtx))
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

  fromClause(ctx) {
    const filePath = ctx.StringLiteral[0].image;
    // Убираем кавычки
    const cleanPath = filePath.substring(1, filePath.length - 1);

    return {
      type: "FromClause",
      file: cleanPath
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
    return {
      type: "ComparisonExpression",
      operator: this.visit(ctx.comparisonOperator),
      left: this.visit(ctx.left),
      right: this.visit(ctx.right)
    };
  }

  comparisonOperator(ctx) {
    if (ctx.Gte) return ">=";
    if (ctx.Lte) return "<=";
    if (ctx.Neq) return "!=";
    if (ctx.Gt) return ">";
    if (ctx.Lt) return "<";
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
  const ast = astVisitor.visit(cst);

  return ast;
}


const examples = [
  "select [age, name] from 'input.json'",
  "select [имя_пользователя, возраст] from 'input.json'",
  "select -[age, name] from 'input.json'",
  "select [settings.theme.color, name] from 'input.json'",
  "select [new_age_key: age, new_name_key: name, profile] from 'input.json'",
  "select [s: sum(a, b, c), average: avg(a, b)] from 'input.json'",
  "select [s: a + b + c] from 'input.json'",
  "select [d: a - b] from 'input.json'",
  "select [m: a * b] from 'input.json'",
  "select [d: a / b] from 'input.json'",
  "select [result: (a + b) * c] from 'input.json'",
  "select [cleaned: trimLeft('http://', url), name] from 'input.json'",
  "select [cleaned: trimRight('.com', url), name] from 'input.json'",
  "select [users[3].subscribers[0].name] from 'input.json'",
  "select [subscribers_number: length(users[3].subscribers), subscriber_name_length: length(users[3].subscribers[0].name)] from 'input.json'",
  "select total_sum: sum(a, b), total_avg: avg(c, d), e_number: count(e) from 'input.json'",
  "select max_salary: max(salary), min_salary: min(salary) from 'input.json'",
  "select [a, b] where a > 5 and (b < 10 or d = 'value') from 'input.json'",
  "select sum_a: sum(a) where c != 4 from 'input.json'",
  "select s: sum(a * avg(b, c)) from 'input.json'"
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
