import { Parser } from "prettier";
import { createIdGenerator } from "./create-id-generator";

export const parseTT2: Parser<TT2Node>["parse"] = (
  text,
  parsers,
  options
) => {
  const regex =
    /{{(?<startdelimiter>-|<|%|\/\*)?\s*(?<statement>(?<keyword>if|range|block|with|define|end|else|prettier-ignore-start|prettier-ignore-end)?[\s\S]*?)\s*(?<endDelimiter>-|>|%|\*\/)?}}|(?<unformattableScript><(script)((?!<)[\s\S])*>((?!<\/script)[\s\S])*?{{[\s\S]*?<\/(script)>)|(?<unformattableStyle><(style)((?!<)[\s\S])*>((?!<\/style)[\s\S])*?{{[\s\S]*?<\/(style)>)/g;
  const root: TT2Root = {
    type: "root",
    content: text,
    aliasedContent: "",
    children: {},
    index: 0,
    contentStart: 0,
    length: text.length,
  };
  const nodeStack: (TT2Block | TT2Root)[] = [root];
  const getId = createIdGenerator();

  for (let match of text.matchAll(regex)) {
    const current = last(nodeStack);
    const keyword = match.groups?.keyword as TT2BlockKeyword | undefined;
    const statement = match.groups?.statement;
    const unformattable =
      match.groups?.unformattableScript ?? match.groups?.unformattableStyle;

    const startDelimiter = (match.groups?.startdelimiter ??
      "") as TT2InlineStartDelimiter;
    const endDelimiter = (match.groups?.endDelimiter ??
      "") as TT2InlineEndDelimiter;

    if (current === undefined) {
      throw Error("Node stack empty.");
    }

    if (match.index === undefined) {
      throw Error("Regex match index undefined.");
    }
    const id = getId();
    if (unformattable) {
      current.children[id] = {
        id,
        type: "unformattable",
        index: match.index,
        length: match[0].length,
        content: unformattable,
        parent: current,
      };
      continue;
    }

    if (statement === undefined) {
      throw Error("Formattable match without statement.");
    }

    const inline: TT2Inline = {
      index: match.index,
      length: match[0].length,
      startDelimiter,
      endDelimiter,
      parent: current!,
      type: "inline",
      statement,
      id,
    };

    if (keyword === "end" || keyword === "prettier-ignore-end") {
      if (current.type !== "block") {
        throw Error("Encountered unexpected end keyword.");
      }

      current.length = match[0].length + match.index - current.index;
      current.content = text.substring(current.contentStart, match.index);
      current.aliasedContent = aliasNodeContent(current);
      current.end = inline;

      if (current.parent.type === "double-block") {
        const firstChild = current.parent.blocks[0];
        const lastChild =
          current.parent.blocks[current.parent.blocks.length - 1];

        current.parent.length =
          lastChild.index + lastChild.length - firstChild.index;
      }

      nodeStack.pop();
    } else if (isBlock(current) && keyword === "else") {
      const nextChild: TT2Block = {
        type: "block",
        start: inline,
        end: null,
        children: {},
        keyword: keyword,
        index: match.index,
        parent: current.parent,
        contentStart: match.index + match[0].length,
        content: "",
        aliasedContent: "",
        length: -1,
        id: getId(),
        startDelimiter,
        endDelimiter,
      };

      if (isMultiBlock(current.parent)) {
        current.parent.blocks.push(nextChild);
      } else {
        const multiBlock: TT2MultiBlock = {
          type: "double-block",
          parent: current.parent,
          index: current.index,
          length: -1,
          keyword,
          id: current.id,
          blocks: [current, nextChild],
        };
        nextChild.parent = multiBlock;
        current.parent = multiBlock;

        if ("children" in multiBlock.parent) {
          multiBlock.parent.children[multiBlock.id] = multiBlock;
        } else {
          throw Error("Could not find child in parent.");
        }
      }

      current.id = getId();
      current.length = match[0].length + match.index - current.index;
      current.content = text.substring(current.contentStart, match.index);
      current.aliasedContent = aliasNodeContent(current);

      nodeStack.pop();
      nodeStack.push(nextChild);
    } else if (keyword) {
      const block: TT2Block = {
        type: "block",
        start: inline,
        end: null,
        children: {},
        keyword: keyword as TT2BlockKeyword,
        index: match.index,
        parent: current,
        contentStart: match.index + match[0].length,
        content: "",
        aliasedContent: "",
        length: -1,
        id: getId(),
        startDelimiter,
        endDelimiter,
      };

      current.children[block.id] = block;
      nodeStack.push(block);
    } else {
      current.children[inline.id] = inline;
    }
  }

  if (!isRoot(nodeStack.pop()!)) {
    throw Error("Missing end block.");
  }

  root.aliasedContent = aliasNodeContent(root);

  return root;
};

function aliasNodeContent(current: TT2Block | TT2Root): string {
  let result = current.content;

  Object.entries(current.children)
    .sort(([_, node1], [__, node2]) => node2.index - node1.index)
    .forEach(
      ([id, node]) =>
        (result =
          result.substring(0, node.index - current.contentStart) +
          id +
          result.substring(node.index + node.length - current.contentStart))
    );

  return result;
}

function last<T>(array: T[]): T | undefined {
  return array[array.length - 1];
}

export type TT2Node =
  | TT2Root
  | TT2Block
  | TT2Inline
  | TT2MultiBlock
  | TT2Unformattable;

export type TT2BlockKeyword =
  | "if"
  | "range"
  | "block"
  | "with"
  | "define"
  | "else"
  | "prettier-ignore-start"
  | "prettier-ignore-end"
  | "end";

export type TT2Root = { type: "root" } & Omit<
  TT2Block,
  | "type"
  | "keyword"
  | "parent"
  | "statement"
  | "id"
  | "startDelimiter"
  | "endDelimiter"
  | "start"
  | "end"
>;

export interface TT2BaseNode<Type extends string> {
  id: string;
  type: Type;
  index: number;
  length: number;
  parent: TT2Block | TT2Root | TT2MultiBlock;
}

export interface TT2Block extends TT2BaseNode<"block">, WithDelimiter {
  keyword: TT2BlockKeyword;
  children: {
    [id: string]: TT2Node;
  };
  start: TT2Inline;
  end: TT2Inline | null;
  content: string;
  aliasedContent: string;
  contentStart: number;
}

export interface TT2MultiBlock extends TT2BaseNode<"double-block"> {
  blocks: (TT2Block | TT2MultiBlock)[];
  keyword: TT2BlockKeyword;
}

export type TT2SharedDelimiter = "%" | "-" | "";
export type TT2InlineStartDelimiter = "<" | "/*" | TT2SharedDelimiter;
export type TT2InlineEndDelimiter = ">" | "*/" | TT2SharedDelimiter;

export interface TT2Unformattable extends TT2BaseNode<"unformattable"> {
  content: string;
}

export interface WithDelimiter {
  startDelimiter: TT2InlineStartDelimiter;
  endDelimiter: TT2InlineEndDelimiter;
}

export interface TT2Inline extends TT2BaseNode<"inline">, WithDelimiter {
  statement: string;
}

export function isInline(node: TT2Node): node is TT2Inline {
  return node.type === "inline";
}

export function isBlock(node: TT2Node): node is TT2Block {
  return node.type === "block";
}

export function isMultiBlock(node: TT2Node): node is TT2MultiBlock {
  return node.type === "double-block";
}

export function isRoot(node: TT2Node): node is TT2Root {
  return node.type === "root";
}

export function isUnformattable(node: TT2Node): node is TT2Root {
  return node.type === "unformattable";
}
