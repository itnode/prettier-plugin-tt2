import {
  doc,
  AstPath,
  Parser,
  ParserOptions,
  Printer,
  SupportLanguage,
} from "prettier";
import { builders, utils } from "prettier/doc";
import { parsers as htmlParsers } from "prettier/parser-html";
import {
  TT2Block,
  TT2Inline,
  TT2InlineEndDelimiter,
  TT2InlineStartDelimiter,
  TT2MultiBlock,
  TT2Node,
  TT2Root,
  TT2Unformattable,
  isBlock,
  isMultiBlock,
  isRoot,
  parseTT2,
} from "./parse";

const htmlParser = htmlParsers.html;
const PLUGIN_KEY = "tt2";

type ExtendedParserOptions = ParserOptions<TT2Node> &
  PrettierPluginTT2ParserOptions;

export type PrettierPluginTT2ParserOptions = {
  tt2BracketSpacing: boolean;
};

export const options: {
  [K in keyof PrettierPluginTT2ParserOptions]: any;
} = {
  tt2BracketSpacing: {
    type: "boolean",
    category: "Global",
    description:
      "Specifies whether the brackets should have spacing around the statement.",
    default: true,
  },
};

export const languages: SupportLanguage[] = [
  {
    name: "TT2",
    parsers: [PLUGIN_KEY],
    extensions: [
      ".tt2",
      ".tt",
      ".html.tt2",
      ".html.tt"
    ],
    vscodeLanguageIds: ["tt2", "TT2"],
  },
];
export const parsers = {
  [PLUGIN_KEY]: <Parser<TT2Node>>{
    astFormat: PLUGIN_KEY,
    preprocess: (text) =>
      // Cut away trailing newline to normalize formatting.
      text.endsWith("\n") ? text.slice(0, text.length - 1) : text,
    parse: parseTT2,
    locStart: (node) => node.index,
    locEnd: (node) => node.index + node.length,
  },
};
export const printers = {
  [PLUGIN_KEY]: <Printer<TT2Node>>{
    print: (path, options: ExtendedParserOptions, print) => {
      const node = path.getNode();

      switch (node?.type) {
        case "inline":
          return printInline(node, path, options, print);
        case "double-block":
          return printMultiBlock(node, path, print);
        case "unformattable":
          return printUnformattable(node, options);
      }

      throw new Error(
        `An error occured during printing. Found invalid node ${node?.type}.`
      );
    },
    embed: (path, print, textToDoc, options) => {
      try {
        return embed(path, print, textToDoc, options);
      } catch (e) {
        console.error("Formatting failed.", e);
        throw e;
      }
    },
  },
};

const embed: Exclude<Printer<TT2Node>["embed"], undefined> = (
  path,
  print,
  textToDoc,
  options
) => {
  const node = path.getNode();

  if (!node) {
    return null;
  }

  /*if (hasPrettierIgnoreLine(node)) {
    return options.originalText.substring(
      options.locStart(node),
      options.locEnd(node)
    );
  }*/

  if (node.type !== "block" && node.type !== "root") {
    return null;
  }

  if (node.mustBeHidden) return [];

  const html = textToDoc(node.aliasedContent, {
    ...options,
    parser: "html",
    parentParser: "tt2",
  });

  const mapped = utils.stripTrailingHardline(
    utils.mapDoc(html, (currentDoc) => {
      if (typeof currentDoc !== "string") {
        return currentDoc;
      }

      let result: builders.Doc = currentDoc;

      Object.keys(node.children).forEach(
        (key) =>
          (result = doc.utils.mapDoc(result, (docNode) =>
            typeof docNode !== "string" || !docNode.includes(key)
              ? docNode
              : [
                  docNode.substring(0, docNode.indexOf(key)),
                  path.call<any,any,any>(print, "children", key),

                  docNode.substring(docNode.indexOf(key) + key.length),
                ]
          ))
      );

      return result;
    })
  );

  if (isRoot(node)) {
    return [mapped, builders.hardline];
  }

  const startStatement = path.call(print, "start");
  const endStatement = node.end ? path.call<any,any>(print, "end") : "";

  /*if (isPrettierIgnoreBlock(node)) {
    return [
      utils.removeLines(path.call(print, "start")),
      printPlainBlock(node.content),
      endStatement,
    ];
  }*/

  const content = node.aliasedContent.trim()
    ? builders.indent([builders.softline, mapped])
    : "";

  const result = [
    startStatement,
    content,
    builders.softline,
    endStatement,
  ];

  const emptyLine =
    !!node.end && isFollowedByEmptyLine(node.end, options.originalText)
      ? builders.softline
      : "";

  if (isMultiBlock(node.parent)) {
    return [result, emptyLine];
  }

  

  return builders.group([builders.group(result), emptyLine], {
    shouldBreak: !!node.end && hasNodeLinebreak(node.end, options.originalText),
  });
};

type PrintFn = (path: AstPath<TT2Node>) => builders.Doc;

function printMultiBlock(
  node: TT2MultiBlock,
  path: AstPath<TT2Node>,
  print: PrintFn
): builders.Doc {
  return path.map(print, "blocks");
}

function isFollowedByNode(node: TT2Inline): boolean {
  const parent = getFirstBlockParent(node).parent;
  const start = parent.aliasedContent.indexOf(node.id) + node.id.length;

  let nextNodeIndex = -1;
  Object.keys(parent.children).forEach((key) => {
    const index = parent.aliasedContent.indexOf(key, start);
    if (nextNodeIndex == -1 || index < nextNodeIndex) {
      nextNodeIndex = index;
    }
  });

  return !!parent.aliasedContent
    .substring(start, nextNodeIndex)
    .match(/^\s+$/m);
}

function printInline(
  node: TT2Inline,
  path: AstPath<TT2Node>,
  options: ExtendedParserOptions,
  print: PrintFn
): builders.Doc {

  const isBlockNode = isBlockEnd(node) || isBlockStart(node);
  const emptyLine =
    isFollowedByEmptyLine(node, options.originalText) && isFollowedByNode(node)
      ? builders.softline
      : "";

  const result: builders.Doc[] = [
    printStatement(node.statement, options.tt2BracketSpacing, {
      start: node.startDelimiter, 
      end: node.endDelimiter,
    }),
  ];

  return builders.group([...result, emptyLine], {
    shouldBreak: hasNodeLinebreak(node, options.originalText) && !isBlockNode,
  });
}

function isBlockEnd(node: TT2Inline) {
  const { parent } = getFirstBlockParent(node);
  return isBlock(parent) && parent.end === node;
}

function isBlockStart(node: TT2Inline) {
  const { parent } = getFirstBlockParent(node);
  return isBlock(parent) && parent.start === node;
}

function printStatement(
  statement: string,
  addSpaces: boolean,
  delimiter: { start: TT2InlineStartDelimiter; end: TT2InlineEndDelimiter } = {
    start: "",
    end: "",
  }
) {
  const space = addSpaces ? " " : "";
  const shouldBreak = statement.includes("\n");

  /*const content = shouldBreak
    ? statement
        .trim()
        .split("\n")
        .map((line, _, array) =>
          array.indexOf(line) === array.length - 1
            ? builders.concat([line.trim(), builders.softline])
            : builders.indent(builders.concat([line.trim(), builders.softline]))
        )
    : [statement.trim()];*/

  const content = [statement];

  return builders.group(
    [
      "[",
      delimiter.start,
      space,
      ...content,
      /*shouldBreak ? "" : */space,
      delimiter.end,
      "]",
    ]/*,
    { shouldBreak }*/
  );
}

/*function hasPrettierIgnoreLine(node: TT2Node) {
  if (isRoot(node)) {
    return false;
  }

  const { parent, child } = getFirstBlockParent(node);

  const regex = new RegExp(
    `(?:<!--|{{).*?prettier-ignore.*?(?:-->|}})\n.*${child.id}`
  );

  return !!parent.aliasedContent.match(regex);
}

function isPrettierIgnoreBlock(node: TT2Node) {
  return false;//isBlock(node) && node.keyword === "prettier-ignore-start";
}*/

function hasNodeLinebreak(node: TT2Inline, source: string) {
  const start = node.index + node.length;
  const end = source.indexOf("\n", start);
  const suffix = source.substring(start, end);

  return !suffix;
}

function isFollowedByEmptyLine(node: TT2Inline, source: string) {
  const start = node.index + node.length;
  const firstLineBreak = source.indexOf("\n", start);
  const secondLineBreak = source.indexOf("\n", firstLineBreak + 1);
  const emptyLine = source
    .substring(firstLineBreak + 1, secondLineBreak)
    .trim();
  const isLastNode = !!source.substring(start).match(/^\s*$/);

  return (
    firstLineBreak !== -1 && secondLineBreak !== -1 && !emptyLine && !isLastNode
  );
}

function getFirstBlockParent(node: Exclude<TT2Node, TT2Root>): {
  parent: TT2Block | TT2Root;
  child: typeof node;
} {
  let previous = node;
  let current = node.parent;

  while (!isBlock(current) && !isRoot(current)) {
    previous = current;
    current = current.parent;
  }

  return {
    child: previous,
    parent: current,
  };
}

function printUnformattable(
  node: TT2Unformattable,
  options: ExtendedParserOptions
) {
  const start = options.originalText.lastIndexOf("\n", node.index - 1);
  const line = options.originalText.substring(start, node.index + node.length);
  const lineWithoutAdditionalContent =
    line.replace(node.content, "").match(/\s*$/)?.[0] ?? "";

  return printPlainBlock(lineWithoutAdditionalContent + node.content, false);
}

function printPlainBlock(text: string, hardlines = true): builders.Doc {
  const isTextEmpty = (input: string) => !!input.match(/^\s*$/);

  const lines = text.split("\n");

  const segments = lines.filter(
    (value, i) => !(i == 0 || i == lines.length - 1) || !isTextEmpty(value)
  );

  return [
    ...segments.map((content, i) =>
      [
        hardlines || i ? builders.hardline : "",
        builders.trim,
        content,
      ]
    ),
    hardlines ? builders.hardline : "",
  ];
}
