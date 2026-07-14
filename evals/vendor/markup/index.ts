// The markup dialect's public surface. canvas_render compiles a markup document
// here, then feeds the resulting spec through prepareSpec exactly as if the model
// had authored the JSON by hand — the runtime never learns which door the spec
// came in through.

export { compileMarkup, type MarkupCompileResult } from "./compiler.ts";
