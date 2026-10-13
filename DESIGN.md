# Node Flow Design System

<!-- impeccable:design-schema 1 -->

## Mode

Operate. The workbench supports a continuous loop of finding a node, composing a flow, configuring it, validating it, running it, and inspecting the result.

## Visual Direction

The canonical surface is a dark workflow workbench: a near-black, dotted canvas sits between dense graphite utility panels. It follows the supplied Figma reference rather than a generic dashboard pattern. The canvas stays visually dominant; surrounding chrome is quiet, compact, and sharply aligned.

## Foundations

- **Canvas:** `--workbench-canvas` with a subtle star-dot field establishes spatial orientation without competing with nodes.
- **Surfaces:** `--workbench-panel`, `--workbench-panel-strong`, and `--workbench-card` separate navigation, canvas, and inspection through small luminance steps rather than large borders.
- **Semantic color:** teal indicates valid data/success, amber denotes attention or selection, blue is the committed primary action, and red is destructive/error only.
- **Typography:** Chinese UI copy uses a compact system sans stack with a clear three-level hierarchy: 11px metadata, 12–13px operational controls, 16px+ state titles. Long labels truncate at control boundaries; explanatory copy uses strict, balanced Chinese line breaking.
- **Geometry:** 4px rhythm, 8px component rounding, one-pixel low-contrast dividers, and 52px top bar. Default desktop columns allocate 17% palette, 63% canvas, and 20% inspector.

## Interaction Rules

- Keep established keyboard commands, button names, node drag/click behavior, saved panel state, and APIs intact.
- Use icon-first compact controls at constrained desktop widths while retaining accessible labels and tooltips.
- The palette remains immediately usable; density is reduced through row styling and preview, not by hiding the default node set.
- Empty canvas guidance presents templates as an optional accelerant and keeps the manual node-add path visible.
- Focus, hover, selected, disabled, running, warning, and error states must remain visibly distinct without relying on color alone.

## Responsive Behavior

- Up to 1100px: secondary top-bar labels are visually compacted so the canvas does not acquire horizontal page overflow.
- Up to 760px: the header becomes a single responsive row and template cards stack; the existing workbench interaction model remains available.

## Implementation Anchors

- Tokens and visual primitives: `apps/web/src/index.css`
- App shell and panel proportions: `apps/web/src/components/WorkflowWorkbenchLayout.tsx`
- Command hierarchy: `apps/web/src/components/WorkflowTopbar.tsx`
- Canvas and empty-state rendering: `apps/web/src/components/FlowCanvas.tsx`
