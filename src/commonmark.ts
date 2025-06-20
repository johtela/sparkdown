/**
 * # CommonMark Tests
 * 
 * This module contains tests from [CommonMark][] test suite to verify that
 * the parser is working correctly.
 * 
 * [CommonMark]: https://spec.commonmark.org/0.31.2/
 */
import { StyledElement } from 'litscript/lib/src/custom-elem'
import { elem, text, highlightWs  } from './helpers'
import { appendMarkdown } from './parser'
import './commonmark.css'
let loaded = import('./spec.json')
/**
 * ## CommonMark Test Cases
 * 
 * We read the CommonMark test cases from a JSON file. Its structure is defined 
 * below (unused properties are omitted).
 */
interface CommonMarkTest {
    markdown: string
    html: string
    example: number
    section: string
}
let tests: CommonMarkTest[]
/**
 * ## CommonMark Test Runner
 * 
 * We define a custom element that can be used run tests specified in the 
 * `examples` attribute. It has format `1,3-5` where you can specify individual
 * tests separated by commas, or range of tests separated by dash.
 */
export class CommonMarkRunner extends StyledElement {
    
    static get observedAttributes(): string[] {
        return  ["examples"]
    }

    constructor() {
        super('commonmark')
    }
    
    protected override connect() {
        this.runExamples()
    }

    private get examples(): number[]  {
        let res: number[] = []
        let examples = this.getAttribute("examples")
        if (examples) {
            let splitter = /\s*(?<sep>[,\-])?\s*(?<num>\d+)/g
            let prev: number | undefined
            let match: RegExpExecArray | null
            while (match = splitter.exec(examples)) {
                let { sep, num } = match.groups!
                let curr = Number.parseInt(num)
                if (prev && sep == "-")
                    for (let i = prev + 1; i < curr; ++i)
                        res.push(i)
                res.push(curr)       
                prev = curr
            }
        }
        return res
    }

    private async runExamples() {
        if (!tests)
            tests = await loaded
        this.examples.forEach(num => this.runTest(tests[num - 1]))
    }

    private runTest(test: CommonMarkTest) {
        let duration = 0
        let result = "<<Not run>>"
        try {
            let root = elem('div')
            let start = window.performance.now()
            appendMarkdown(test.markdown, root)
            duration = window.performance.now() - start
            result = root.innerHTML
        }
        catch (e) {
            if (e instanceof Error)
                result = e.message + "\n" + e.stack
        }
        this.renderTest(test, result, result == test.html, duration)
    }

    private renderTest(test: CommonMarkTest, result: string, pass: boolean,
        duration: number) {
        let passcell = elem('th', text(pass ? "PASS" : "FAIL"))
        passcell.className = pass ? "pass" : "fail"
        this.body.append(elem('table', 
            elem('tr',
                elem('th', text(`Example: ${test.example}`)),
                elem('th', text(test.section)),
                passcell),
            elem('tr',
                elem('th', text("Input")),
                elem('th', text("Expected")),
                elem('th', text("Actual"))),
            elem('tr',
                elem('td', elem('pre', elem('code', 
                    ...highlightWs(test.markdown)))),
                elem('td', elem('pre', elem('code', ...highlightWs(test.html)))),
                elem('td', elem('pre', elem('code', ...highlightWs(result))))),
            elem('tr', 
                elem('td', text(`In ${duration.toFixed(1)}ms`)))))
    }
}
customElements.define("commonmark-runner", CommonMarkRunner)