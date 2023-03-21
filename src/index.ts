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
import { createIdGenerator } from "./create-id-generator";
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
  KeyW,
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


function hasSubContentLinebreak(node: TT2Block | TT2MultiBlock | TT2Root) {
  if (node.type == "double-block") {
    for (let block of node.blocks) { if (hasSubContentLinebreak(block)) return true; }
  } else {
    if (node.aliasedContent.includes("\n")) return true;

    for (let child_node of Object.values(node.children)) {
      if (child_node.type == "block" || child_node.type == "root" || child_node.type == "double-block") {
        if (hasSubContentLinebreak(child_node)) return true;
      }
    }
  }

  return false;
}

function setSubContentLinebreak(node: TT2Block | TT2MultiBlock | TT2Root): boolean {
  node.subContentHasLinebreak = false;

  if (node.type == "double-block") {
    node.subContentHasLinebreak = hasSubContentLinebreak(node);

    for (let block of node.blocks) {
      setSubContentLinebreak(block);

      block.subContentHasLinebreak = block.subContentHasLinebreak || node.subContentHasLinebreak;
    }
  } else {
    if (node.aliasedContent.includes("\n")) 
      node.subContentHasLinebreak = true;
    
    for (let child_node of Object.values(node.children)) {
      if (child_node.type == "block" || child_node.type == "root" || child_node.type == "double-block") {
        if (setSubContentLinebreak(child_node)) node.subContentHasLinebreak = true;
      }
    }

  }

  return node.subContentHasLinebreak;
}

export const printers = {
  [PLUGIN_KEY]: <Printer<TT2Node> & {preprocess: (ast: TT2Node,options: any)=>TT2Node}>{
    preprocess: (ast: TT2Node,options: any) => {
      if (ast.type == "root" || ast.type == "block" || ast.type == "double-block") 
          setSubContentLinebreak(ast);
      return ast;
    },
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

  if (node.type !== "block" && node.type !== "root") {
    return null;
  }
  

  const html = textToDoc(node.aliasedContent, {
    ...options,
    parser: "html",
    parentParser: "tt2",
    htmlWhitespaceSensitivity: "strict"
  });
  
  
  const mapped = utils.stripTrailingHardline(utils.mapDoc(html, (currentDoc) => {
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
  }));

  if (isRoot(node)) {
    return [mapped, builders.hardline];
  }

  const startStatement = path.call(print, "start");
  const endStatement = node.end ? path.call<any,any>(print, "end") : "";

  const usePlainTextInner = node.keyword === KeyW.PerlBlock;
  const hasSomelineBreakInContent = node.subContentHasLinebreak;
  const isContentEmpty = node.aliasedContent.trim() === "";

  let proto_content;
  if (usePlainTextInner) {
    proto_content = hasSomelineBreakInContent ? 
      printIndentedPerlBlock(node.content) : 
      node.content;
  } else {
    proto_content = hasSomelineBreakInContent
      ? (isContentEmpty ? builders.indent(mapped) : builders.indent([builders.hardline, mapped]) )
      : mapped;
  }
  const content = proto_content;
  
  //TODO: Testen ob hier Teil der Fehler entstehen
  const trimSplit = (!hasSomelineBreakInContent && node.aliasedContent.trim() !== node.aliasedContent)
        ? node.aliasedContent.split(node.aliasedContent.trim()) : [];
  const beforeContent = trimSplit.length > 0 ? trimSplit[0] : "";
  const afterContent = trimSplit.length > 1 ? trimSplit[1] : "";

  //if (node.start.statement.includes("RAWPERL")) console.log(content,hasSomelineBreakInContent,"'"+afterContent+"'");

  const result: doc.builders.Doc = [
    startStatement,
    beforeContent,
    content,
    afterContent,
    hasSomelineBreakInContent /*&& !usePlainTextInner*/ /*&& !isContentEmpty*/ ? builders.hardline : "",
    endStatement,
  ];

  const emptyLine = 
    !!node.end && isFollowedByEmptyLine(node.end, options.originalText)
      ? builders.hardline
      : "";

  if (isMultiBlock(node.parent)) {
    return [result, emptyLine];
  }

  return builders.group([builders.group(result), emptyLine], { //TODO: Änderung rückgangig machen?
    shouldBreak: true//!!node.end && hasNodeLinebreak(node.end, options.originalText),
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
      ? builders.hardline
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

  return builders.group(
    [
      "[",
      delimiter.start,
      delimiter.start.includes("#") ? "" : space,
      statement,
      statement.endsWith("\n") ? "" : space,
      delimiter.end,
      "]",
    ],
  );
}

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

  return printUnformattablePlainBlock(lineWithoutAdditionalContent + node.content, false);
}

function printUnformattablePlainBlock(text: string, hardlines = true): builders.Doc {
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


function printIndentedPerlBlock(text: string): builders.Doc {
  const lines = text.split("\n");

  let indexOfFirstLineIFShouldNothaveHardline = lines[0].trim() == "" ? 0 : -1;
  let indexOfLastLineIFShouldNothaveHardline = lines[lines.length-1].trim() == "" ? lines.length - 1 : -1;

  return builders.indent([
    ...lines.map((content,i) =>
      [
        i > indexOfFirstLineIFShouldNothaveHardline && i !== indexOfLastLineIFShouldNothaveHardline ? builders.hardline : "",
        content.trim(),
      ]
    ),
  ]);
}
