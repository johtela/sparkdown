/**
 * # Markdown Parser
 *
 * This module implements a self-contained Markdown parser. It does not import 
 * or depend on any external libraries. The parsing process closely follows the 
 * strategy outlined in the [CommonMark specification][].
 *
 * Note: The parser is not fully CommonMark compliant. Some of the more obscure 
 * rules have been intentionally omitted to keep the code simple.
 *
 * ## Matchers and Parsers
 *
 * We start by defining a _matcher_, a function that is called when a regular 
 * expression matches a pattern representing a Markdown element. It receives the 
 * current parser state and the match(es) as arguments. A matcher must be 
 * provided for all Markdown [blocks and inlines][].
 *
 * [CommonMark specification]: https://spec.commonmark.org/0.31.2/#appendix-a-parsing-strategy
 * [blocks and inlines]: https://spec.commonmark.org/0.31.2/#blocks-and-inlines
 */
export type Matcher = (state: ParserState, match: RegExpExecArray) => void
/**
 * A matcher is combined with its corresponding regular expression in the
 * `Parser` interface. This interface associates a regular expression pattern
 * with the function that handles matches for that pattern.
 */
export interface Parser {
    regexp: string
    matched: Matcher
}
/**
 * ## Blocks
 * 
 * A Markdown document is divided into _blocks_. Each block corresponds to an 
 * HTML element with a `display` style of `block`, such as headers, lists, or 
 * paragraphs. Blocks can contain _inline_ elements, including links, emphasized 
 * text, or code spans. Information about open blocks is stored in the 
 * `DocumentBlock` interface.
 */
enum BlockType { Text, Inline, Html }

export interface DocumentBlock {
    /**
     * The element that corresponds to the block.
     */
    element: Element
    /**
     * In some cases, child nodes should be appended to a different parent 
     * element than the block's main element. The `parent` property allows 
     * specifying an alternative parent element for such scenarios.
     */
    parent: Element
    /**
     * Indicates whether the block contains inline elements (such as links or 
     * emphasis) or only plain verbatim text. This flag determines how the 
     * block's content should be processed and rendered when the block is 
     * flushed.
     */
    type: BlockType
    /**
     * Indicates whether this block is a leaf block (cannot contain child 
     * blocks) or a container block (can contain child blocks). Leaf blocks 
     * contain only text or inline elements, while container blocks may nest
     * other blocks (e.g. lists or blockquotes).
     */
    leaf: boolean
    /**
     * Each entry in this array represents a line of markdown text that is part 
     * of the content for this block. These lines are accumulated as the parser 
     * processes the input, and are later used to generate the final HTML 
     * content for the block.
     */
    lines: string[]
    /**
     * Optional regular expression that must match the beginning of subsequent 
     * Markdown lines for this block to continue. If provided, lines that do not 
     * match will cause the block to be closed.
     */
    cont?: RegExp
    /**
     * If set, the line that terminates the block will be included in it.
     */
    includeTerm: boolean
}
/**
 * ## Parser State
 *
 * The parser state encapsulates the current position and context of the parsing 
 * process. It includes:
 *
 *  - `input`: The full Markdown source string being parsed.
 *  - `nextIndex`: The current position in the input string from which parsing 
 *    should continue.
 *  - `blocks`: A stack of open `DocumentBlock` objects representing the current 
 *    block structure.
 *
 * This state object is passed to matcher functions and updated as the parser 
 * advances through the input.
 */
export interface ParserState {
    input: string
    nextIndex: number
    blocks: DocumentBlock[]
}
/**
 * ## Constructors
 * 
 * Helper functions for creating parsers and DOM elements.
 */
export function parser(matched: Matcher, regexp: string): Parser {
    return { matched, regexp }
}
/**
 * Creates a new parser state based on the given state, but with a new input 
 * string and optionally a new starting index. The `blocks` stack is shared with 
 * the original state.
 */
function stateFrom(state: ParserState, input: string, nextIndex = 0):
    ParserState {
    return { input, nextIndex, blocks: state.blocks }
}
/**
 * The `elem` function creates an HTML element of the specified `tag` type.
 * Optionally, any number of child nodes can be appended to the created element.
 * This provides a convenient way to construct DOM trees.
 */
export function elem<K extends keyof HTMLElementTagNameMap>(tag: K, 
    ...children: Node[]): HTMLElementTagNameMap[K] {
    let res = document.createElement(tag)
    if (children.length > 0)
        res.append(...children)
    return res
}
/**
 * Creates a text node containing the specified string data.
 */
export function text(data: string): Text {
    return document.createTextNode(data)
}
/**
 * ## Opening and Closing Blocks
 *
 * Functions for managing the stack of open blocks during parsing.
 *
 * - `openBlock` pushes a new block onto the stack. You must specify the parser 
 *   state, the element to associate with the block, and whether the block is 
 *   inline. By default, the block is a leaf, the parent is the element itself, 
 *   and it has no continuation regexp. The block's lines array is always 
 *   initialized as empty.
 *
 * - `closeLastBlock` pops the most recently opened block from the stack and 
 *   appends its element to its parent element in the previous block.
 */
function openBlock(state: ParserState, element: Element, type: BlockType, 
    leaf = true, parent = element, cont?: RegExp, includeTerm = false) {
    state.blocks.push(
        { element, parent, type, leaf, lines: [], cont, includeTerm })
}
/**
 * Pops the last block from the stack and appends its element to the parent
 * element of the previous block in the stack.
 */
function closeLastBlock(state: ParserState) {
    let block = state.blocks.pop()
    let element = block!.element
    let parent = lastBlock(state)?.parent
    if (parent && parent != element)
        parent.append(element)
}
/**
 * Returns the topmost (most recently opened) block from the parser state's 
 * stack.
 */
function lastBlock(state: ParserState): DocumentBlock {
    return state.blocks[state.blocks.length - 1]
}
/**
 * Appends one or more nodes to the parent element of the current (topmost) 
 * block.
 */
function append(state: ParserState, ...nodes: Node[]) {
    lastBlock(state).parent.append(...nodes)
}
/**
 * Append verbatitm HTML to the parent of the current block.
 */
function appendHtml(state: ParserState, html: string) {
    lastBlock(state).parent.insertAdjacentHTML('beforeend', html)
}
/**
 * ## Constructing Combined Regular Expressions
 * 
 * This function takes a list of parsers and combines their regular expressions
 * into a single RegExp. Each parser's pattern is wrapped in a named capturing
 * group (`g0`, `g1`, ...), so we can later determine which parser matched.
 * The `sticky` parameter controls whether the resulting RegExp uses the "y"
 * (sticky) flag, which is needed for block parsing.
 */
function regexpFor(parsers: Parser[], sticky: boolean): RegExp {
    let re = parsers.map((p, i) => `(?<g${i}>${p.regexp})`).join("|")
    return new RegExp(re, sticky ? "yui" : "gui")
}
/**
 * The `parseNext` function attempts to match the next token in the input using 
 * the combined regular expression and the list of parsers. It takes the regexp, 
 * the parser array, the current parser state, and a flag indicating whether we 
 * are parsing inline content. If a match is found:
 * 
 *  1. It flushes any unprocessed text before the match (for inlines) or the 
 *     last block (for blocks).
 *  2. It invokes the matcher function for the matched parser.
 *  3. It advances the `nextIndex` to continue parsing after the match.
 * 
 * Returns `true` if a parser matched, otherwise `false`.
 */
function parseNext(regexp: RegExp, parsers: Parser[], state: ParserState, 
    inline: boolean): boolean {
    if (state.nextIndex >= state.input.length)
        return false
    regexp.lastIndex = state.nextIndex
    let match = regexp.exec(state.input)
    if (match && match.groups) {
        let parser = parsers.find((_, i) => match.groups![`g${i}`] != undefined)
        if (parser) {
            if (inline)
                flushInline(state, match.index)
            else
                flushLastBlock(state)
            state.nextIndex = match.index + match[0].length
            parser.matched(state, match)
            return true
        }
    }
    return false
}
/**
 * ## Reusable Regular Expressions
 *
 * Common RegExp fragments used throughout the parser:
 *
 * - `wsOrPunct`: Matches whitespace, punctuation, or symbol characters 
 *   (Unicode-aware).
 * - `emOrStrong`: Matches one or two consecutive `_` or `*` characters, for 
 *   emphasis and strong emphasis.
 * - `indentedCode`: Matches lines that begin with at least four spaces and/or
 *   a tab, used for indented code blocks.
 * - `nonBlank`: Matches any line containing at least one non-whitespace 
 *   character.
 */
const wsOrPunct = /[\s\p{P}\p{S}]/u.source
const emOrStrong = /(__?|\*\*?)/.source
const indentedCode = / {4}| {0,3}\t/yu
const nonBlank = /(?=.*\S)/yu
/**
 * ## Inline Parsers
 *
 * Inline parser handle Markdown elements that can appear within block-level
 * content, such as emphasis, links, code spans, and images. The `flushInline`
 * function appends any unprocessed input as a text node to the current block,
 * from the parser state's current index up to the specified position (or to 
 * the end of input if no position is given).
 */
function flushInline(state: ParserState, index?: number) {
    if (index == undefined || index > state.nextIndex)
        append(state, text(state.input.substring(state.nextIndex, index)))
}
/**
 * An array of inline Markdown parsers, each responsible for handling a specific
 * inline syntax element. Each paser is defined with a matching regular 
 * expression and a matcher function that processes the matched content and 
 * updates the parser state accordingly.
 *
 * The supported inline elements include:
 * - Escapes: Handles backslash-escaped characters and line breaks.
 * - Code Spans: Handles inline code delimited by backticks.
 * - Links: Parses standard Markdown links of the form `[text](url)`.
 * - Images: Parses image syntax `![alt](src)`.
 * - Emphasis & Strong: Handles emphasis (`*` or `_`) and strong emphasis 
 *   (`**` or `__`).
 * - Raw HTML: Passes through raw HTML tags.
 */
const inlineParsers = [
    parser(
        /**
         * ### Escapes
         *
         * Handles Markdown escape sequences. A backslash before a punctuation 
         * or symbol character escapes it, rendering the character literally. If 
         * the backslash is at the end of a line, it produces a `<br>` element 
         * instead.
         */
        (state, match) => {
            let { esc } = match.groups!
            if (esc == "\n")
                append(state, elem('br'))
            append(state, text(esc))
        },
        /\\(?<esc>[\p{P}\p{S}\n])/u.source),
    parser(
        /**
         * ### Entity and Numeric Character References
         *
         * Handles HTML entities and numeric character references such as
         * `&amp;`, `&#123;`, and `&#x1F600;`. These are inserted as text nodes
         * so that the browser will decode them when rendering.
         */
        (state, match) => {
            let { entity } = match.groups!
            appendHtml(state, entity)
        },
        /(?<entity>&(?:[a-z]\w*|#\d{1,7}|#[Xx][\da-f]{1,6});)/.source),
    parser(
        /**
         * ### Code Spans
         *
         * Handles inline code spans delimited by backticks, following the main
         * rules from [section 6.1](https://spec.commonmark.org/0.31.2/#code-spans)
         * of the CommonMark specification:
         * 
         * - The opening and closing backtick sequences must match in length.
         * - Leading and trailing spaces inside the code span are trimmed to a 
         *   single space.
         * - Newlines inside code spans are replaced with spaces.
         * - Backticks inside code spans are allowed if multiple backticks open
         *   it.
         */
        (state, match) => {
            let { code } = match.groups!
            let cnt = code.length
            if (cnt > 2 && code[0] == " " && code[cnt - 1] == " ")
                code = code.substring(1, cnt - 1)
            append(state, elem('code', text(code.replaceAll("\n", " "))))
        },
        /(?<codedelim>`+)(?<code> .+ |[^`]+)\k<codedelim>/.source),
    parser(
        /**
         * ### Links
         *
         * Handles Markdown links in the format `[text](url)`. This 
         * implementation focuses on the most common use case and does not
         * support reference-style or nested links, in line with the goal of 
         * simplicity. Escaped brackets and parentheses are unescaped in both 
         * the link text and destination.
         */
        (state, match) => {
            let { link, linkdest } = match.groups!
            linkdest = linkdest.replaceAll(/\\\(|\\\)/, str => str[1])
            let aelem = elem('a')
            aelem.href = linkdest
            openBlock(state, aelem, BlockType.Inline)
            inlines(stateFrom(state, link))
            closeLastBlock(state)
        },
        /\[(?<link>(?:\\\[|\\\]|[^\[\]])+)\]\((?<linkdest>(?:\\\(|\\\)|[^\s()])+)\)/.source),
    parser(
        /**
         * ### Images
         *
         * Handles Markdown image syntax of the form `![alt](src)`. This parser 
         * extracts the alt text and image source, unescapes any escaped 
         * brackets or parentheses, and creates an `<img>` element with the 
         * appropriate `alt` and `src` attributes.
         */
        (state, match) => {
            let { imgalt, imgsrc } = match.groups!
            imgalt = imgsrc.replaceAll(/\\\[|\\\]/, str => str[1])
            imgsrc = imgsrc.replaceAll(/\\\(|\\\)/, str => str[1])
            let img = elem('img')
            img.src = imgsrc
            img.alt = imgalt
            append(state, img)
        },
        /!\[(?<imgalt>(?:\\\[|\\\]|[^\[\]])+)\]\((?<imgsrc>(?:\\\(|\\\)|[^\s()])+)\)/.source),
    parser(
        /**
         * ### Emphasis and Strong
         *
         * Handles Markdown emphasis (`*` or `_`) and strong emphasis (`**` or 
         * `__`). This parser matches one or two consecutive asterisks or 
         * underscores, ensuring correct boundaries according to the CommonMark 
         * rules:
         * 
         * - Single delimiter for `<em>`, double for `<strong>`.
         * - Delimiters must not be surrounded by whitespace or punctuation.
         * - The content between delimiters is parsed recursively for inline 
         *   elements.
         */
        (state, match) => {
            let { emdelim, em } = match.groups!
            openBlock(state, elem(emdelim.length == 1 ? 'em' : 'strong'), 
                BlockType.Inline)
            inlines(stateFrom(state, em))
            closeLastBlock(state)
        },
        `(?<emdelim>${emOrStrong}(?!${wsOrPunct})|(?<=${wsOrPunct}|^)${
        emOrStrong})(?<em>.*)((?<!${wsOrPunct})\\k<emdelim>|\\k<emdelim>(?=${
        wsOrPunct}|$))`),
    parser(
        /**
         * ### Raw HTML
         *
         * Passes through raw HTML tags as actual HTML elements. The parser 
         * matches any sequence that looks like an HTML tag with content (e.g., 
         * `<b>text</b>`, `<span class="x">foo</span>`, or self-closing tags 
         * like `<br/>`). The matched HTML is parsed and inserted as a DOM node, 
         * so the HTML is rendered in the output.
         */
        (state, match) => {
            let { html } = match.groups!
            appendHtml(state, html)
        },
        /(?<html><(?<tag>[a-z]\w*)([\s\n]+[a-z]\w*\s*(=\s*".*")?)*[\s\n]*(>.*<\/\k<tag>[\s\n]*>|\/>))/.source)
]
/**
 * We initialize the combined regexp when it is first used. Thus we can register 
 * new inline parsers before calling the parser. After that the list of parsers
 * is locked down.
 */
let inlineRegexp: RegExp 
/**
 * This function repeatedly applies inline parsers using a regular expression
 * matcher until no more matches are found. After all inline elements have been
 * parsed, it flushes any remaining inline content in the parser state.
 */
function inlines(state: ParserState) {
    inlineRegexp = inlineRegexp || regexpFor(inlineParsers, false)
    while (parseNext(inlineRegexp, inlineParsers, state, true));
    flushInline(state)
}
/**
 * ## Block Parsers
 * 
 * Block parsers are defined similarly to inline parsers, each with a regular 
 * expression and a mtcher function. Block-level elements are parsed 
 * line-by-line, as blocks have a nested, hierarchical structure. The combined 
 * regular expression matches block prefixes that indicate different block 
 * types.
 * 
 * ### HTML Blocks
 *
 * This parser specifically matches HTML blocks starting with specified pattern, 
 * which can contain blank lines and are terminated only by their corresponding 
 * end pattern. The parser continues the block until the closing tag is found, 
 * including all lines in between as raw HTML.
 * 
 * Normally the parser opens a block to collect the lines in an HTML block. But 
 * if the end tag is at the same line, we just append the line as HTML into the 
 * parent block.
 * 
 * Also the last line, which doesn't match the continuation regexp, is included 
 * in the block. We use positive an negative lookahead in the regexps to keep 
 * the match position at the beginning of the line.
 */
function htmlBlock(start: string, end: string): Parser {
    return parser(
        (state,) => {
            let cont = new RegExp(`(?!.*(?:${end}))`, "yui")
            let line = state.input
            cont.lastIndex = state.nextIndex
             if (cont.test(line))
                openBlock(state, lastBlock(state).parent, BlockType.Html, 
                    true, undefined, cont, true)
            else {
                appendHtml(state, line.slice(state.nextIndex) + "\n")
                state.nextIndex = line.length
            }
       }, `(?=${start})`)
}

const blockParsers = [
    parser(
        /**
         * ### Thematic Breaks
         *
         * Matches a horizontal rule (thematic break) as defined by CommonMark:
         * a line containing at least three consecutive `*`, `-`, or `_` 
         * characters, possibly separated by spaces or tabs, and nothing else.
         * Produces an `<hr>` element.
         */
        (state,) => append(state, elem('hr')),
        / {0,3}(?<brkchar>[*\-_])(?:\s*\k<brkchar>){2,}\s*$/.source),
    parser(
        /**
         * ### ATX Headers
         *
         * Matches ATX-style headers (lines starting with 1-6 `#` characters).
         * The number of `#` characters determines the header level (`<h1>` to 
         * `<h6>`). The header text is parsed for inline elements.
         */
        (state, match) => {
            let { atxlevel, atxheader } = match.groups!
            let level = atxlevel.length
            openBlock(state, elem(<keyof HTMLElementTagNameMap>`h${level}`), 
                BlockType.Inline)
            inlines(stateFrom(state, atxheader))
            closeLastBlock(state)
        },
        / {0,3}(?<atxlevel>#{1,6})\s+(?<atxheader>.+?)\s*$/.source),
    parser(
        /**
         * ### Indented Code Blocks
         *
         * Matches code blocks that are indented by at least 4 spaces or a tab.
         * The content is collected as-is and rendered inside a `<pre><code>` 
         * block.
         */
        (state,) => {
            let code = elem('code')
            openBlock(state, elem('pre', code), BlockType.Text, true, code,
                indentedCode)
        },
        indentedCode.source),
    htmlBlock("<pre|<script|<style|<textarea",
        "<\\/pre>|<\\/script>|<\\/style>|<\\/textarea>"),
    htmlBlock("<!--", "-->"),
    htmlBlock("<\\?", "\\?>"),
    htmlBlock("<![a-z]", ">"),
    htmlBlock("<!\\[CDATA\\[", "\\]\\]>"),
    // parser(
        /**
         * 
         */
        // (state,) => {
        // },
        // /a/.source),
    parser(
        /**
         * ### Paragraphs
         * 
         * A sequence of non-blank lines that cannot be interpreted as other 
         * kinds of blocks forms a paragraph.
         */
        (state,) => 
            openBlock(state, elem('p'), BlockType.Inline, true, undefined, 
                nonBlank),  
        nonBlank.source)
]
/**
 * The combined regexp for all block parsers.
 */
const blockRegexp = regexpFor(blockParsers, true)
/**
 * Flushes the lines collected in the last block of the parser state.
 * 
 * If the block contains any lines, they are joined into a single string.
 * Depending on whether the block is marked as inline, the function either:
 * - Processes the lines as inline content using the `inlines` function, or
 * - Appends the lines as a text block using the `append` function.
 * 
 * After flushing, the block's `lines` array is cleared.
 */
function flushLastBlock(state: ParserState) {
    let block = lastBlock(state)
    if (block.lines.length > 0) {
        let lines = block.lines.join("\n")
        switch (block.type) {
            case BlockType.Inline:
                inlines(stateFrom(state, lines))
                break
            case BlockType.Text:
                append(state, text(lines))
                break
            case BlockType.Html:
                appendHtml(state, lines + "\n")
                break
        }
        block.lines = []
    }
}
/**
 * Closes and flushes all open blocks in the parser state upto the specified 
 * index. This is used to unwind the block stack to a certain depth.
 */
function closeBlocksToIndex(state: ParserState, index: number) {
    while (state.blocks.length > index) {
        flushLastBlock(state)
        closeLastBlock(state)
    }
}
/**
 * Iterates through the current parser state's block stack and closes any blocks
 * that are no longer continued by the input at the current parsing position.
 *
 * For each block, if it has a continuation regular expression (`cont`), we
 * attempt to match it against the input at the current position. If the match 
 * fails or does not start at the current position, all blocks from the current 
 * index onward are closed by calling `closeBlocksToIndex`.
 *
 * Updates the parser state's `nextIndex` to reflect the position after a 
 * successful match.
 */
function closeDiscontinuedBlocks(state: ParserState) {
    for (let i = 0; i < state.blocks.length; ++i) {
        let block = state.blocks[i]
        if (block.cont) {
            block.cont.lastIndex = state.nextIndex
            let match = block.cont.exec(state.input)
            if (!match || match.index != 0) {
                if (block.includeTerm) {
                    block.lines.push(state.input.slice(state.nextIndex))
                    state.nextIndex = state.input.length
                }
                return closeBlocksToIndex(state, i)
            }
            state.nextIndex = block.cont.lastIndex
        }
    }
}
/**
 * ## Main Parsing Function
 * 
 * `appendMarkdown` converts a Markdown string to HTML and appends the result 
 * to the given DOM element.
 *
 * The implementation works as follows:
 * 
 *  1.  Initializes the parser state with the input string and an empty block 
 *      stack.
 * 
 *  2.  Opens a root block associated with the provided DOM element.
 * 
 *  3.  Splits the input into lines and processes each line:
 * 
 *      1.  For each line, creates a temporary parser state for that line.
 *      2.  Closes any blocks that are no longer continued by the current line.
 *      3.  If the topmost block is not a leaf block, attempts to match 
 *          block-level elements using the registered block parsers.
 *      4.  If any unprocessed content remains, it is added to the current 
 *          block's lines.
 * 
 *  4.  After all lines are processed, flushes and closes all blocks, ensuring 
 *      that the resulting HTML structure is complete.
 */
export function appendMarkdown(input: string, doc: Element) {
    let state: ParserState = {
        input,
        nextIndex: 0,
        blocks: []
    }
    openBlock(state, doc, BlockType.Inline, false)
    let lines = input.split("\n")
    for (let i = 0; i < lines.length; ++i) {
        let line = lines[i]
        let st = stateFrom(state, line, 0)
        closeDiscontinuedBlocks(st)
        while (!lastBlock(st).leaf && 
            parseNext(blockRegexp, blockParsers, st, false));
        lastBlock(st).lines.push(line.slice(st.nextIndex))
    }
    closeBlocksToIndex(state, 0)
}