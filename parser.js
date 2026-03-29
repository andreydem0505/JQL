import { createToken, Lexer, CstParser } from "chevrotain";

const Select = createToken({ name: "Select", pattern: /select/i });
const From = createToken({ name: "From", pattern: /from/i });
const Where = createToken({ name: "Where", pattern: /where/i });
const And = createToken({ name: "And", pattern: /and/i });
const Or = createToken({ name: "Or", pattern: /or/i });

const LSquare = createToken({ name: "LSquare", pattern: /\[/ });
const RSquare = createToken({ name: "RSquare", pattern: /]/ });
const LParen = createToken({ name: "LParen", pattern: /\(/ });
const RParen = createToken({ name: "RParen", pattern: /\)/ });
const Comma = createToken({ name: "Comma", pattern: /,/ });
const Colon = createToken({ name: "Colon", pattern: /:/ });
const Dot = createToken({ name: "Dot", pattern: /\./ });
const Minus = createToken({ name: "Minus", pattern: /-/ });
const Plus = createToken({ name: "Plus", pattern: /\+/ });
const Star = createToken({ name: "Star", pattern: /\*/ });
const Slash = createToken({ name: "Slash", pattern: /\// });
const Gte = createToken({ name: "Gte", pattern: />=/ });
const Lte = createToken({ name: "Lte", pattern: /<=/ });
const Neq = createToken({ name: "Neq", pattern: /!=/ });
const Gt = createToken({ name: "Gt", pattern: />/ });
const Lt = createToken({ name: "Lt", pattern: /</ });
const Eq = createToken({ name: "Eq", pattern: /=/ });

const NumberLiteral = createToken({ name: "NumberLiteral", pattern: /\d+(?:\.\d+)?/ });
const Identifier = createToken({ name: "Identifier", pattern: /[^\s\[\]\(\),:.+\-*/'"<>=!]+/ });
const StringLiteral = createToken({ name: "StringLiteral", pattern: /'[^']*'/ });

const Sum = createToken({ name: "Sum", pattern: /sum/i, longer_alt: Identifier });
const Avg = createToken({ name: "Avg", pattern: /avg/i, longer_alt: Identifier });
const Count = createToken({ name: "Count", pattern: /count/i, longer_alt: Identifier });
const Max = createToken({ name: "Max", pattern: /max/i, longer_alt: Identifier });
const Min = createToken({ name: "Min", pattern: /min/i, longer_alt: Identifier });
const TrimLeft = createToken({ name: "TrimLeft", pattern: /trimLeft/i, longer_alt: Identifier });
const TrimRight = createToken({ name: "TrimRight", pattern: /trimRight/i, longer_alt: Identifier });

const WhiteSpace = createToken({
    name: "WhiteSpace",
    pattern: /\s+/,
    group: Lexer.SKIPPED
});

const allTokens = [
    WhiteSpace,

    Select,
    From,
    Where,
    And,
    Or,
    Sum,
    Avg,
    Count,
    Max,
    Min,
    TrimLeft,
    TrimRight,

    LSquare,
    RSquare,
    LParen,
    RParen,
    Comma,
    Colon,
    Dot,
    Plus,
    Star,
    Slash,
    Gte,
    Lte,
    Neq,
    Gt,
    Lt,
    Eq,
    Minus,

    NumberLiteral,
    Identifier,
    StringLiteral
];

export const JQLLexer = new Lexer(allTokens);

export class JQLParser extends CstParser {
    constructor() {
        super(allTokens);

        const $ = this;

        $.RULE("query", () => {
            $.SUBRULE($.selectClause);
            $.OPTION(() => {
                $.SUBRULE($.whereClause);
            });
            $.SUBRULE($.fromClause);
        });

        $.RULE("selectClause", () => {
            $.CONSUME(Select);
            $.OR([
                { ALT: () => $.SUBRULE($.fieldList) },
                { ALT: () => $.SUBRULE($.aggregateFieldList) },
            ]);
        });

        $.RULE("fieldList", () => {
            $.OPTION(() => {
                $.CONSUME(Minus);
            });
            $.CONSUME(LSquare);
            $.SUBRULE($.fields);
            $.CONSUME(RSquare);
        });

        $.RULE("aggregateFieldList", () => {
            $.AT_LEAST_ONE_SEP({
                SEP: Comma,
                DEF: () => {
                    $.SUBRULE($.aggregateField);
                }
            });
        });

        $.RULE("aggregateField", () => {
            $.CONSUME(Identifier, { LABEL: "alias" });
            $.CONSUME(Colon);
            $.SUBRULE($.functionCall);
        });

        $.RULE("fields", () => {
            $.AT_LEAST_ONE_SEP({
                SEP: Comma,
                DEF: () => {
                    $.SUBRULE($.field);
                }
            });
        });

        $.RULE("field", () => {
            $.OPTION(() => {
                $.CONSUME(Identifier, { LABEL: "alias" });
                $.CONSUME(Colon);
            });
            $.SUBRULE($.expression);
        });

        $.RULE("expression", () => {
            $.SUBRULE($.additionExpression);
        });

        $.RULE("additionExpression", () => {
            $.SUBRULE($.multiplicationExpression, { LABEL: "lhs" });
            $.MANY(() => {
                $.OR([
                    { ALT: () => $.CONSUME(Plus) },
                    { ALT: () => $.CONSUME(Minus) }
                ]);
                $.SUBRULE2($.multiplicationExpression, { LABEL: "rhs" });
            });
        });

        $.RULE("multiplicationExpression", () => {
            $.SUBRULE($.atomicExpression, { LABEL: "lhs" });
            $.MANY(() => {
                $.OR([
                    { ALT: () => $.CONSUME(Star) },
                    { ALT: () => $.CONSUME(Slash) }
                ]);
                $.SUBRULE2($.atomicExpression, { LABEL: "rhs" });
            });
        });

        $.RULE("atomicExpression", () => {
            $.OR([
                { ALT: () => $.SUBRULE($.functionCall) },
                { ALT: () => $.SUBRULE($.fieldPath) },
                { ALT: () => $.CONSUME(NumberLiteral) },
                {
                    ALT: () => {
                        $.CONSUME(LParen);
                        $.SUBRULE($.expression);
                        $.CONSUME(RParen);
                    }
                }
            ]);
        });

        $.RULE("fieldPath", () => {
            $.AT_LEAST_ONE_SEP({
                SEP: Dot,
                DEF: () => {
                    $.CONSUME(Identifier);
                }
            });
        });

        $.RULE("functionCall", () => {
            $.SUBRULE($.functionName);
            $.CONSUME(LParen);
            $.SUBRULE($.functionArgs);
            $.CONSUME(RParen);
        });

        $.RULE("functionName", () => {
            $.OR([
                { ALT: () => $.CONSUME(Sum) },
                { ALT: () => $.CONSUME(Avg) },
                { ALT: () => $.CONSUME(Count) },
                { ALT: () => $.CONSUME(Max) },
                { ALT: () => $.CONSUME(Min) },
                { ALT: () => $.CONSUME(TrimLeft) },
                { ALT: () => $.CONSUME(TrimRight) }
            ]);
        });

        $.RULE("functionArgs", () => {
            $.AT_LEAST_ONE_SEP({
                SEP: Comma,
                DEF: () => {
                    $.SUBRULE($.functionArgument, { LABEL: "arg" });
                }
            });
        });

        $.RULE("functionArgument", () => {
            $.OR([
                { ALT: () => $.CONSUME(StringLiteral) },
                { ALT: () => $.SUBRULE($.expression) }
            ]);
        });

        $.RULE("fromClause", () => {
            $.CONSUME(From);
            $.CONSUME(StringLiteral);
        });

        $.RULE("whereClause", () => {
            $.CONSUME(Where);
            $.SUBRULE($.orCondition);
        });

        $.RULE("orCondition", () => {
            $.SUBRULE($.andCondition, { LABEL: "lhs" });
            $.MANY(() => {
                $.CONSUME(Or);
                $.SUBRULE2($.andCondition, { LABEL: "rhs" });
            });
        });

        $.RULE("andCondition", () => {
            $.SUBRULE($.whereFactor, { LABEL: "lhs" });
            $.MANY(() => {
                $.CONSUME(And);
                $.SUBRULE2($.whereFactor, { LABEL: "rhs" });
            });
        });

        $.RULE("whereFactor", () => {
            $.OR([
                { ALT: () => $.SUBRULE($.comparisonCondition) },
                {
                    ALT: () => {
                        $.CONSUME(LParen);
                        $.SUBRULE($.orCondition);
                        $.CONSUME(RParen);
                    }
                }
            ]);
        });

        $.RULE("comparisonCondition", () => {
            $.SUBRULE($.whereOperand, { LABEL: "left" });
            $.SUBRULE($.comparisonOperator);
            $.SUBRULE2($.whereOperand, { LABEL: "right" });
        });

        $.RULE("comparisonOperator", () => {
            $.OR([
                { ALT: () => $.CONSUME(Gte) },
                { ALT: () => $.CONSUME(Lte) },
                { ALT: () => $.CONSUME(Neq) },
                { ALT: () => $.CONSUME(Gt) },
                { ALT: () => $.CONSUME(Lt) },
                { ALT: () => $.CONSUME(Eq) }
            ]);
        });

        $.RULE("whereOperand", () => {
            $.OR([
                { ALT: () => $.SUBRULE($.fieldPath) },
                { ALT: () => $.CONSUME(NumberLiteral) },
                { ALT: () => $.CONSUME(StringLiteral) }
            ]);
        });

        this.performSelfAnalysis();
    }
}
