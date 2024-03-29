import { Parser } from "prettier";
import { createIdGenerator } from "./create-id-generator";

const regexDirective = /\[(?<tag>[%*])(?<chompBegin>[+-])?(?<ignoreDirective>#)?[^\S\r\n]*(?<content>[\S\s]*?)[^\S\r\n]*(?<chompEnd>[+-])?\1\]|(?<unformattableScript><(script)((?!<)[\s\S])*>((?!<\/script)[\s\S])*?\[(?:[%*])[\s\S]*?<\/(script)>)|(?<unformattableStyle><(style)((?!<)[\s\S])*>((?!<\/style)[\s\S])*?\[(?:[%*])[\s\S]*?<\/(style)>)/g;
const regexContent = /(?<!#.*|(?:LAST|NEXT|BREAK)\s+)(?<isMacro>MACRO\s(?<macroName>[\s\S]+?)\s)?(?:(?<keyword>(?<IgnoreDirectives>SET|GET)|(?<BlockStartBlock>(?:(?:SET\s+?)?\S+?\s+=\s?)?BLOCK)|(?<BlockStartIf>IF)|(?<BlockContinueIf>ELSIF|ELSE)|(?<BlockStartTry>TRY)|(?<BlockContinueTry>CATCH|FINAL)|(?<BlockStartSwitch>SWITCH)|(?<BlockContinueCase>CASE)|(?<BlockStartMisc>UNLESS|FOREACH|FOR|WHILE|WRAPPER|VIEW|(?<![^;\s]+?\s+)FILTER)|(?<BlockStartPerl>PERL|RAWPERL)|(?<BlockEnd>END))(?:(?:'[\s\S]*?')|(?:[^;'"]*?)|(?:"[\s\S]*?"))*?(?:\s*;\s*|\s[\s\S]+?;\s*|(?:\s[\s\S]*?)?$))/g;


export enum KeyW {
  SimpleDirective,
  StartBlock,
  ContinueBlock,
  SwitchBlock,
  CaseBlock,
  EndBlock,

  PerlBlock
}

function handleTT2Dir(match: RegExpMatchArray): KeyW[] {
  if (match.groups === undefined) return [KeyW.SimpleDirective];
  let mg: {[key: string]: string | undefined} = match.groups;

  if (mg.ignoreDirective || !(mg.content !== undefined )) return [KeyW.SimpleDirective];
  let inner = mg.content.matchAll(regexContent);

  let res = [];
  let openedBlocks: number = 0;

  for (let i of inner) {
    if (i.groups === undefined) continue;
    let ig: {[key: string]: string | undefined} = i.groups;

    if (ig.BlockEnd) {
      
      if (openedBlocks == 0) {
        res.push(KeyW.EndBlock);
      } else {
        res.splice(res.lastIndexOf(KeyW.StartBlock));
        openedBlocks -= 1;
      }

    } else if (ig.BlockStartIf) {
      
      res.push(KeyW.StartBlock);
      openedBlocks += 1;

    } else if (ig.BlockContinueIf) {

      res.push(KeyW.ContinueBlock);

    } else if (ig.BlockStartMisc) {

      res.push(KeyW.StartBlock);
      openedBlocks += 1;

    } else if (ig.BlockStartBlock) {

      res.push(KeyW.StartBlock);
      openedBlocks += 1;

    } else if (ig.BlockStartSwitch) {

      res.push(KeyW.SwitchBlock);
      openedBlocks += 1;

    } else if (ig.BlockContinueCase) {
      
      res.push(KeyW.CaseBlock);

    } else if (ig.BlockStartTry) {

      res.push(KeyW.StartBlock);
      openedBlocks += 1;

    } else if (ig.BlockContinueTry) {

      res.push(KeyW.ContinueBlock);

    } else if (ig.BlockStartPerl) {
      
      res.push(KeyW.PerlBlock);
      openedBlocks += 1;

    }

  }

  if (res.length == 0) return [KeyW.SimpleDirective];

  return res;
}


export const parseTT2: Parser<TT2Node>["parse"] = (
  text,
  parsers,
  options
) => {
  const regex = regexDirective;
  const root: TT2Root = {
    type: "root",
    content: text,
    aliasedContent: "",
    children: {},
    index: 0,
    contentStart: 0,
    length: text.length
  };
  const nodeStack: (TT2Block | TT2Root)[] = [root];
  const getId = createIdGenerator();

  for (let match of text.matchAll(regex)) {
    if (match.index === undefined) {
      throw Error("Regex match index undefined.");
    }

    const [current,keywordArr,statement,unformattable,startDelimiter,endDelimiter] = getCurrentNodeAndKeyWords(nodeStack,match);

    const id = getId();
    if (unformattable) {
      current.children[id] = {
        id,
        type: "unformattable",
        index: match.index,
        length: match[0].length,
        content: unformattable,
        parent: current
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
      id
    };

    if (keywordArr.length == 1) {
      let keyword = keywordArr[0];

      if (keyword === KeyW.EndBlock) {
        if (current.type !== "block") {
          console.log(text.substring(0,inline.index).split("\n").length );
          throw Error("Encountered unexpected end keyword.");
        }
  
        if (current.keyword !== KeyW.CaseBlock) {
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
        } else {
          current.length = match.index - current.index;
          current.content = text.substring(current.contentStart,match.index);
          current.aliasedContent = aliasNodeContent(current);

          if (current.parent.type === "double-block") {
            const firstChild = current.parent.blocks[0];
            const lastChild =
              current.parent.blocks[current.parent.blocks.length - 1];
    
            current.parent.length =
              lastChild.index + lastChild.length - firstChild.index;
          }

          nodeStack.pop();

          const [outer_current,outer_keywordArr,outer_statement,outer_unformattable,outer_startDelimiter,outer_endDelimiter] = getCurrentNodeAndKeyWords(nodeStack,match);

          if (outer_current.type !== "block") {
            throw Error("Encountered unexpected end keyword.");
          }

          inline.parent = outer_current;

          outer_current.length = match[0].length + match.index - outer_current.index;
          outer_current.content = text.substring(outer_current.contentStart, match.index);
          outer_current.aliasedContent = aliasNodeContent(outer_current);
          outer_current.end = inline;
    
          if (outer_current.parent.type === "double-block") {
            const firstChild = outer_current.parent.blocks[0];
            const lastChild =
            outer_current.parent.blocks[outer_current.parent.blocks.length - 1];
    
            outer_current.parent.length =
              lastChild.index + lastChild.length - firstChild.index;
          }

          nodeStack.pop();
        }

        
      } else if (isBlock(current) && (keyword === KeyW.ContinueBlock || (keyword == KeyW.CaseBlock && current.keyword == KeyW.CaseBlock))) {
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
          endDelimiter
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
            blocks: [current, nextChild]
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
      } else if (keyword === KeyW.StartBlock || keyword === KeyW.PerlBlock || keyword === KeyW.SwitchBlock || (keyword === KeyW.CaseBlock)) {
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
          endDelimiter
        };

        inline.parent = block;

        current.children[block.id] = block;
        nodeStack.push(block);
      } else {
        current.children[inline.id] = inline;
      }
    } else if (keywordArr.length > 1) {
      current.children[inline.id] = inline;
    }
    
  }

  if (!isRoot(nodeStack.pop()!)) {
    throw Error("Missing end block.");
  }

  root.aliasedContent = aliasNodeContent(root);

  return root;
};

function getCurrentNodeAndKeyWords(nodeStack: (TT2Block | TT2Root)[],match: RegExpMatchArray): [TT2Block | TT2Root, KeyW[], string | undefined, string | undefined, TT2InlineStartDelimiter, TT2InlineEndDelimiter] {
  const current = last(nodeStack);
  const keywordArr = handleTT2Dir(match);

  const statement = match.groups?.content;
  const unformattable =
    match.groups?.unformattableScript ?? match.groups?.unformattableStyle;

  const startDelimiter = ((match.groups?.tag ?? "") + (match.groups?.chompBegin ?? "")) + (match.groups?.ignoreDirective ?? "") as TT2InlineStartDelimiter;
  const endDelimiter = ((match.groups?.chompEnd ?? "") + (match.groups?.tag ?? "")) as TT2InlineEndDelimiter;
  
  if (current === undefined) {
    throw Error("Node stack empty.");
  }
  
  return [current, keywordArr, statement, unformattable, startDelimiter, endDelimiter];
}

function aliasNodeContent(current: TT2Block | TT2Root): string {
  let result = current.content;

  Object.entries(current.children)
    .sort(([_, node1], [__, node2]) => node2.index - node1.index)
    .forEach(
      ([id, node]) => {
        result =
          result.substring(0, node.index - current.contentStart) +
          id +
          result.substring(node.index + node.length - current.contentStart);
      }
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

export type TT2BlockKeyword = KeyW;

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

  subContentHasLinebreak?: boolean;
}

export interface TT2MultiBlock extends TT2BaseNode<"double-block"> {
  blocks: (TT2Block | TT2MultiBlock)[];
  keyword: TT2BlockKeyword;

  subContentHasLinebreak?: boolean;
}

export type TT2InlineStartDelimiter =  "%" |  "%+" |  "%-" |  "*" |  "*+" |  "*-" |  "" |
                                      "%#" | "%+#" | "%-#" | "*#" | "*+#" | "*-#" | "#";
export type TT2InlineEndDelimiter = "%" | "+%" | "-%" | "*" | "+*" | "-*" | "";

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
