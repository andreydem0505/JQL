import { createToken, Lexer, CstParser } from "chevrotain";

const Select = createToken({ name: "Select", pattern: /select\b/i });
const Strict = createToken({ name: "Strict", pattern: /strict\b/i });
const From = createToken({ name: "From", pattern: /from\b/i });
const Where = createToken({ name: "Where", pattern: /where\b/i });
const Group = createToken({ name: "Group", pattern: /group\b/i });
const By = createToken({ name: "By", pattern: /by\b/i });
const Having = createToken({ name: "Having", pattern: /having\b/i });
const And = createToken({ name: "And", pattern: /and\b/i });
const Or = createToken({ name: "Or", pattern: /or\b/i });
const AliasKeyword = createToken({ name: "AliasKeyword", pattern: /alias\b/i });
const AsKeyword = createToken({ name: "AsKeyword", pattern: /as\b/i });
const Left = createToken({ name: "Left", pattern: /left\b/i });
const Right = createToken({ name: "Right", pattern: /right\b/i });
const Inner = createToken({ name: "Inner", pattern: /inner\b/i });
const Join = createToken({ name: "Join", pattern: /join\b/i });
const On = createToken({ name: "On", pattern: /on\b/i });
const After = createToken({ name: "After", pattern: /after\b/i });
const Before = createToken({ name: "Before", pattern: /before\b/i });
const Between = createToken({ name: "Between", pattern: /between\b/i });

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
const Dollar = createToken({ name: "Dollar", pattern: /\$/ });

const NumberLiteral = createToken({ name: "NumberLiteral", pattern: /\d+(?:\.\d+)?/ });
const Identifier = createToken({ name: "Identifier", pattern: /[^\s$\[\](),:.+\-*/'"<>=!]+/ });
const StringLiteral = createToken({ name: "StringLiteral", pattern: /'[^']*'/ });

const Sum = createToken({ name: "Sum", pattern: /sum\b/i, longer_alt: Identifier });
const Avg = createToken({ name: "Avg", pattern: /avg\b/i, longer_alt: Identifier });
const Count = createToken({ name: "Count", pattern: /count\b/i, longer_alt: Identifier });
const Max = createToken({ name: "Max", pattern: /max\b/i, longer_alt: Identifier });
const Min = createToken({ name: "Min", pattern: /min\b/i, longer_alt: Identifier });
const Length = createToken({ name: "Length", pattern: /length\b/i, longer_alt: Identifier });
const TrimLeft = createToken({ name: "TrimLeft", pattern: /trimLeft\b/i, longer_alt: Identifier });
const TrimRight = createToken({ name: "TrimRight", pattern: /trimRight\b/i, longer_alt: Identifier });

const WhiteSpace = createToken({
    name: "WhiteSpace",
    pattern: /\s+/,
    group: Lexer.SKIPPED
});

const tokenAlternatives = ($, tokens) => tokens.map(token => ({ ALT: () => $.CONSUME(token) }));
const ruleAlternatives = (...alternatives) => alternatives.map(ALT => ({ ALT }));

const allTokens = [
    WhiteSpace,

    Select,
    Strict,
    From,
    Where,
    Group,
    By,
    Having,
    And,
    Or,
    AliasKeyword,
    AsKeyword,
    Left,
    Right,
    Inner,
    Join,
    On,
    After,
    Before,
    Between,
    Sum,
    Avg,
    Count,
    Max,
    Min,
    Length,
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
    Dollar,

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
            $.OR(ruleAlternatives(
                () => {
                    $.SUBRULE1($.fromClause);
                    $.OPTION(() => $.SUBRULE1($.whereClause));
                    $.OPTION2(() => $.SUBRULE1($.groupByClause));
                    $.OPTION4(() => $.SUBRULE1($.havingClause));
                },
                () => {
                    $.SUBRULE2($.whereClause);
                    $.SUBRULE2($.fromClause);
                    $.OPTION3(() => $.SUBRULE2($.groupByClause));
                    $.OPTION5(() => $.SUBRULE2($.havingClause));
                }
            ));
        });

        $.RULE("selectClause", () => {
            $.CONSUME(Select);
            $.OPTION(() => {
                $.CONSUME(Strict);
            });
            $.OR(ruleAlternatives(
                () => $.SUBRULE($.fieldList),
                () => $.SUBRULE($.aggregateFieldList)
            ));
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
                $.SUBRULE($.name, { LABEL: "alias" });
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
                $.OR(tokenAlternatives($, [Plus, Minus]));
                $.SUBRULE2($.multiplicationExpression, { LABEL: "rhs" });
            });
        });

        $.RULE("multiplicationExpression", () => {
            $.SUBRULE($.atomicExpression, { LABEL: "lhs" });
            $.MANY(() => {
                $.OR(tokenAlternatives($, [Star, Slash]));
                $.SUBRULE2($.atomicExpression, { LABEL: "rhs" });
            });
        });

        $.RULE("atomicExpression", () => {
            $.OR(ruleAlternatives(
                () => $.SUBRULE($.functionCall),
                () => $.SUBRULE($.fieldPath),
                () => $.CONSUME(NumberLiteral),
                () => {
                    $.CONSUME(LParen);
                    $.SUBRULE($.expression);
                    $.CONSUME(RParen);
                }
            ));
        });

        $.RULE("fieldPath", () => {
            $.AT_LEAST_ONE_SEP({
                SEP: Dot,
                DEF: () => {
                    $.SUBRULE($.pathPart);
                }
            });
        });

        $.RULE("pathPart", () => {
            $.OPTION(() => {
                $.CONSUME(Dollar);
            });
            $.SUBRULE($.pathSegment);
        });

        $.RULE("pathSegment", () => {
            $.SUBRULE($.name);
            $.MANY(() => {
                $.CONSUME(LSquare);
                $.CONSUME(NumberLiteral);
                $.CONSUME(RSquare);
            });
        });

        $.RULE("name", () => {
            $.OR(tokenAlternatives($, [
                Identifier,
                Select,
                Strict,
                From,
                Where,
                Group,
                By,
                Having,
                And,
                Or,
                AliasKeyword,
                AsKeyword,
                Left,
                Right,
                Inner,
                Join,
                On,
                After,
                Before,
                Between,
                Sum,
                Avg,
                Count,
                Max,
                Min,
                Length,
                TrimLeft,
                TrimRight
            ]));
        });

        $.RULE("aggregateField", () => {
            $.SUBRULE($.name, { LABEL: "alias" });
            $.CONSUME(Colon);
            $.SUBRULE($.functionCall);
        });

        $.RULE("functionCall", () => {
            $.SUBRULE($.functionName);
            $.CONSUME(LParen);
            $.SUBRULE($.functionArgs);
            $.CONSUME(RParen);
        });

        $.RULE("functionName", () => {
            $.OR(tokenAlternatives($, [Sum, Avg, Count, Max, Min, Length, TrimLeft, TrimRight]));
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
            $.OR(ruleAlternatives(
                () => $.CONSUME(StringLiteral),
                () => $.SUBRULE($.expression)
            ));
        });

        $.RULE("sourceRef", () => {
            $.CONSUME(StringLiteral);
            $.OPTION(() => {
                $.CONSUME(LSquare);
                $.SUBRULE($.fieldPath, { LABEL: "sourcePath" });
                $.CONSUME(RSquare);
            });
        });

        $.RULE("aliasMapping", () => {
            $.SUBRULE($.fieldPath, { LABEL: "aliasSource" });
            $.CONSUME(AsKeyword);
            $.SUBRULE($.name, { LABEL: "aliasName" });
        });

        $.RULE("legacyAliasSection", () => {
            $.CONSUME(AliasKeyword);
            $.SUBRULE($.aliasMapping);
            $.MANY(() => {
                $.CONSUME(Comma);
                $.SUBRULE2($.aliasMapping);
            });
        });

        $.RULE("joinClause", () => {
            $.OPTION(() => {
                $.OR(tokenAlternatives($, [Left, Right, Inner]));
            });
            $.CONSUME(Join);
            $.SUBRULE($.sourceRef, { LABEL: "source" });
            $.OPTION2(() => {
                $.CONSUME(AsKeyword);
                $.SUBRULE($.name, { LABEL: "joinAlias" });
            });
            $.CONSUME(On);
            $.SUBRULE($.orCondition, { LABEL: "condition" });
        });

        $.RULE("fromClause", () => {
            $.CONSUME(From);
            $.SUBRULE($.sourceRef, { LABEL: "source" });

            $.OPTION(() => {
                $.CONSUME(AsKeyword);
                $.SUBRULE($.name, { LABEL: "sourceAlias" });
            });

            $.MANY(() => {
                $.OR(ruleAlternatives(
                    () => $.SUBRULE($.legacyAliasSection),
                    () => $.SUBRULE($.joinClause)
                ));
            });
        });

        $.RULE("whereClause", () => {
            $.CONSUME(Where);
            $.SUBRULE($.orCondition);
        });

        $.RULE("groupByClause", () => {
            $.CONSUME(Group);
            $.CONSUME(By);
            $.AT_LEAST_ONE_SEP({
                SEP: Comma,
                DEF: () => {
                    $.SUBRULE($.fieldPath, { LABEL: "field" });
                }
            });
        });

        $.RULE("havingClause", () => {
            $.CONSUME(Having);
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
            $.OR(ruleAlternatives(
                () => $.SUBRULE($.comparisonCondition),
                () => {
                    $.CONSUME(LParen);
                    $.SUBRULE($.orCondition);
                    $.CONSUME(RParen);
                }
            ));
        });

        $.RULE("comparisonCondition", () => {
            $.SUBRULE($.whereOperand, { LABEL: "left" });
            $.OR(ruleAlternatives(
                () => {
                    $.SUBRULE($.comparisonOperator);
                    $.SUBRULE2($.whereOperand, { LABEL: "right" });
                },
                () => {
                    $.CONSUME(Between);
                    $.SUBRULE3($.whereOperand, { LABEL: "lower" });
                    $.CONSUME(And);
                    $.SUBRULE4($.whereOperand, { LABEL: "upper" });
                }
            ));
        });

        $.RULE("comparisonOperator", () => {
            $.OR(tokenAlternatives($, [Gte, Lte, Neq, Gt, Lt, Eq, After, Before]));
        });

        $.RULE("whereOperand", () => {
            $.OR(ruleAlternatives(
                () => $.SUBRULE($.fieldPath),
                () => $.CONSUME(NumberLiteral),
                () => $.CONSUME(StringLiteral)
            ));
        });

        this.performSelfAnalysis();
    }
}
