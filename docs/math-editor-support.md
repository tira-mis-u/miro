# Math editor and source support notes

## Editing model and rendering path

The Math surface has two explicit modes: **Rendered** shows the current read-only equation; **Edit LaTeX** opens the editable CodeMirror source with native logical line numbers. This is not a continuously editable WYSIWYG math field, and no rendered layer is placed over the source input. Switching modes and previewing do not rewrite or normalize the authoritative source. Incomplete or unsupported source keeps the last renderable equation available while remaining editable. Palette insertions use the current caret/selection, keep source editing focused after category changes, and form their own undo-history event so filling a template slot is independently undoable.

Palette previews, rendered editor formulas, static board formulas, and source-level delimiter samples all use the app's bundled KaTeX 0.16.39 renderer/configuration. Structure-card previews use actual TeX display style inside an inline KaTeX result; symbols and small delimiters use text style. This changes only the preview's math style, not inserted source or AST.

Template placeholders are stored and inserted as `□` and continue to serialize to the app's existing `\square` placeholder source. Previews make a presentation-only AST copy and render empty slots with KaTeX's real `\square` glyph, restoring the outlined square instead of a `?`; rendering never changes the source tree. The glyph is ordinary renderer-supported notation, not a CSS/SVG overlay or a missing-glyph substitute.

## Palette coverage and rendering limits

Math structure categories remain **Structures**, **Functions**, **Trigonometry**, **Geometry**, and **Calculus & analysis**. The separate symbol groups are Greek, arrows, sets, and **Arithmetic & comparison**. There is no standalone Accent or Other Symbols section. Symbols and structures display KaTeX previews with short visible labels and no explanatory parentheticals. Cards use a 16px preview, a 60px symbol-card minimum, and an 82px structure-card minimum. Every structure template uses the same grid placement; complex previews no longer span a full row.

Geometry keeps supported notation including `\overrightarrow{□}` for a vector and `\overline{□}` for a line/segment. The old **Parallel (//)** palette item is removed; existing `//` or `\parallel` source still parses for compatibility. The paired editable **Angle-bracket expression** uses `\left\langle□\right\rangle`; standalone left/right angle-bracket palette entries are not shown. The operand-free `\angle` symbol remains separate. Similarity appears once in Arithmetic & comparison as the supported `≃` / `\simeq` relation, not a tilde. The Functions group has editable `\log_{□}(□)` and `\ln(□)` templates; `lg` is not offered.

KaTeX 0.16.39 does not support the tested scalable-arc commands `\overparen`, `\wideparen`, or `\overarc`. The misleading **Curved arc accent** Geometry item is therefore removed. Older `\overset{\frown}{...}` source remains parseable and serializes back to native `\overset{\frown}{...}` for compatibility; KaTeX's native fixed-advance frown mark is used as-is. Its width is not claimed to scale with the base. No HTML-class wrapper, CSS pseudo-element, SVG mask, or positioned glyph fragment is used to imitate an arc.

The derivative and partial-derivative templates show display-style fractions and have separate editable variable and expression slots. Integral bounds/conditions, logarithm base/argument, and geometry operands remain editable rather than being baked into standalone examples. Long previews remain in the same consistent structure grid as the other templates.

## Palette sizing, scrolling, and interaction

The palette width is measured from the actual board-workspace element and capped at 640 CSS pixels. A `ResizeObserver` remeasures that workspace on viewport/layout changes, so an open editor does not retain stale dimensions from its initial viewport. The width formula is `min(640, workspaceWidth - 16, 300 + 0.42 × workspaceWidth)`, with a positive lower bound; CSS independently caps it to the browser viewport. Structure cards use an adaptive grid of up to three columns on wider palettes, with a container-width breakpoint switching narrow palettes to one column. Symbol grids auto-fit compact cards. Card labels occupy a separate row beneath the KaTeX preview; all structure templates retain the same grid placement rather than adding full-row cards or nested horizontal scrolling. When the editor and tools cannot fit side-by-side, the editor's measured height and the actual workspace margins/gap are subtracted from the workspace height; the tools panel is capped to that remaining stack space and its content scrolls instead of overlapping the editor.

A Playwright component harness checks the palette at 1280×900 and 360×720, including viewport fit, the three-column desktop/one-column mobile structure layouts, KaTeX preview and label fit, panel scrolling, and the stable scrollbar gutter. These standalone measurements do not include the board's left rail or editor; the integrated panel continues to derive its size and stack position from the measured workspace, and exact dimensions vary with the active editor. The palette body retains a viewport-bounded vertical scroll region with `scrollbar-gutter: stable`, keeping the scrollbar outside the card grid's usable content width. Palette previews do not introduce horizontal scrolling. Pointer-wheel zoom and panel stacking follow the existing board behavior. The editable 1–8-column matrix cell grid may have a horizontal scroll area when the requested number of independently editable cells cannot fit the available panel width.

Palette sections collapse independently. The existing insertion/replacement, cursor focus, undo/redo, persistence, collaboration, and board interactions remain on their existing paths. This UI does not replace the formula source with a fake WYSIWYG surface.

## Structured expression grid

The structured-expression tool has two stages:

1. **Configure:** only numeric Row count, Column count, and Create are shown. Positive whole numbers from 1 through 8 are accepted; empty, zero, negative, decimal, invalid, and out-of-range values are rejected.
2. **Edit:** Create opens a real editable cell grid. It has no layout selector or continuous +/- row/column controls. **Reconfigure** returns to the dimension fields. Increasing or changing dimensions preserves overlapping cells and initializes new cells empty. If a smaller size would discard populated cells, the panel warns first; Cancel retains the existing grid unchanged, while confirmation applies the new dimensions.

The grid serializes as a standard KaTeX-compatible matrix environment with selectable delimiters, then can be reconstructed and reopened from source. The choices include no delimiter, parentheses, square brackets, braces, a one-sided left brace, vertical bars, and the one-sided left square bracket. The square option is previewed by KaTeX as `[x` using `\left[x\right.`. Empty cells remain editable placeholders in the grid model, serialize to the existing `\square` placeholder source, and display as native KaTeX square glyphs. Existing supported array/aligned/cases sources retain compatibility when loaded; layout is inferred from the source rather than selected in Stage A.

## Source and CodeBlock notes

Math source height comes from CodeMirror's measured wrapped document height and is bounded by the actual board viewport. The line-number gutter is CodeMirror-native, so it uses the same wrapping, line blocks, font, zoom, and scroll coordinates as source text. CodeBlock remains a separate CodeMirror editor: its auto-height is derived from logical source lines; manual height is an intentional scroll viewport. Original LF, CRLF, CR, and mixed source separators are tracked separately from CodeMirror's normalized document and restored on copy, edit callbacks, undo, and redo.

Top-level source newlines and explicit row breaks are projected to a gathered math structure for rendering; the source itself is not rewritten. Newlines inside a group or existing environment remain inside that structure. The symbol palette omits the former placeholder “Other Symbols” section rather than presenting a category with no useful catalog.

## Verification scope

Automated verification and actual browser measurements for the current revision are recorded in the task handoff/final report. A local component harness is not evidence that the live application preview gateway works; gateway access is reported separately if unavailable.
