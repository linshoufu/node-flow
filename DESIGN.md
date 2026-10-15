# Node Flow Design System

<!-- impeccable:design-schema 1 -->

## Mode

Operate. The workbench supports a continuous loop of finding a node, composing a flow, configuring it, validating it, running it, and inspecting the result.

## Visual Direction

The canonical surface is a dark workflow workbench: a near-black, dotted canvas sits between graphite utility panels. Floating navigation and canvas controls use restrained glass transparency, a subtle highlight, and soft shadows. Node cards, forms, and result data retain solid dark surfaces for legibility. The canvas stays visually dominant; surrounding chrome is quiet and compact.

## Foundations

- **Canvas:** `--workbench-canvas` with a subtle star-dot field establishes spatial orientation without competing with nodes.
- **Surfaces:** `--workbench-panel`, `--workbench-panel-strong`, and `--workbench-card` separate navigation, canvas, and inspection through small luminance steps rather than large borders.
- **Semantic color:** teal indicates valid data/success, amber denotes attention or selection, blue is the committed primary action, and red is destructive/error only.
- **Typography:** Chinese UI copy uses a compact system sans stack with a clear three-level hierarchy: 11px metadata, 12–13px operational controls, 16px+ state titles. Long labels truncate at control boundaries; explanatory copy uses strict, balanced Chinese line breaking.
- **Geometry:** 4px rhythm, 8–16px component rounding, one-pixel low-contrast dividers, and a 52px floating top bar. The canvas fills the editing area. The 280px node palette and 320px inspector open as overlays. Execution history and results live on a separate page.

## Interaction Rules

- Keep established keyboard commands, button names, node drag/click behavior and APIs intact.
- Use icon-first compact controls at constrained desktop widths while retaining accessible labels and tooltips.
- The palette starts closed and opens through the canvas add-node control. Search and category browsing remain available; adding a node closes the palette. Double-click quick add stays available.
- The palette separates nodes, configured node presets, and multi-node templates into tabs. All use the same icon, title, description and focus treatment. Template eligibility is explained inline; category filters and legacy-node visibility apply only to the node tab. Tabs support arrow keys, Home and End.
- Creation actions belong to the context being saved: node presets in the inspector, loop templates in the loop owner's inspector, and workflow templates in workflow settings. The palette manages personal resources with a separate menu for editing content, renaming and moving to the recoverable trash. Package resources show a read-only label. Content editing uses an isolated canvas draft and an explicit save-to-library toolbar, without workflow execution controls; leaving it restores the original workflow draft.
- Configuration sources are edited beside each value using Fixed / Reference controls. References select a workflow setting or run parameter and show its configured/default value, not a previous run's result. Keep the persisted binding contract separate from literal configuration. Hide reference controls for parameter declarations and dynamic port definitions. Existing nested bindings appear as labeled fields; switching to a fixed value must preserve sibling fields and make the resulting literal editable.
- Empty canvas guidance presents templates as an optional accelerant and keeps the manual node-add path visible.
- Focus, hover, selected, disabled, running, warning, and error states must remain visibly distinct without relying on color alone.
- Built-in node names, descriptions, categories, and icons come from shared presentation helpers. Preserve custom names and original node IDs, port keys, and API payloads.
- Canvas cards and Node Studio previews render the same `NodeCard`. Previews use 100% scale and local sample configuration, including dynamic ports and resolved summary templates; selecting the preview exposes contextual error ports. Preview edits do not update workflow data.
- Node cards place a category icon beside the title, with category and labeled run status below. Inline controls share an inset group; port rows remain aligned at the card edges. Cards use solid graphite gradients, subtle edge highlights, and soft shadows.
- Hovering or selecting a node highlights its direct connections and the corresponding ports at both ends. Other connections soften without disappearing. Leaving the node restores the selected node's connections; clearing selection restores the full graph.
- Presentation updates retain React Flow's measured node dimensions and active drag position. Hover and selection must not hide nodes or restart their initial measurement; actual card size changes remain observed by the renderer.
- The inspector opens when a node is selected and closes when selection is cleared. An empty inspector never reserves canvas width; a selected node's inspector can still be folded manually.
- Numeric fields use the shared `NumberInput`: a value area and explicit minus/plus buttons, with one focus boundary. Native numeric typing, arrow keys, and min/max constraints remain available. Temporary editing text remains intact until blur so clearing or entering a negative number is possible. Other form fields use matching dark surfaces, 34px panel heights, and visible keyboard focus.
- Canvas inline fields and inspector fields share `Switch`, `TextInput`, `NumberInput` and `Select`. Boolean configuration uses a labeled switch with the label on the left and control on the right in both places. Canvas text, number and select fields may use a compact 28px height; styling, focus, disabled states and configuration values stay consistent.
- Data configuration prioritizes the task over implementation details. CSV mapping lists show source column names and target types in compact rows; only one row expands at a time. Source column editing preserves existing validation and calculation rules. Object composition shows an output summary with a separate, wider draft editor for values, input references and nested objects/lists. Cancel discards editor changes. Intermediate calculations, internal field names and raw expressions belong in explicitly opened advanced sections; empty rule editors and full expression source must not dominate the default inspector. Presentation must preserve opaque expressions and never execute or silently normalize them.
- Dropdown fields use the shared `Select`, backed by Radix Select. Triggers share the dark surface, focus ring and chevron; portaled menus use rounded graphite surfaces, a checkmark for selection and a restrained blue hover highlight. Menus must scroll, stay inside the viewport and appear above dialogs. Keep empty/reset choices, required-field validation, disabled options, keyboard navigation and Escape focus restoration; do not introduce visible native selects in individual screens.
- Node Studio groups each port's name, order, and visibility in one card. Labels sit above controls; the editor body scrolls independently while its save action stays visible. Omit empty group separators.
- Batch results show total, passed, failed, and success rate, followed by a filterable, paginated list. A row opens its source data and corresponding response. Execution completion and individual result failure remain distinct; raw events and JSON remain available.
- Opening or closing overlays leaves the canvas dimensions and viewport intact. The fit control provides a view of the complete flow.
- Execution details use the workflow version recorded by the run. The execution canvas supports pan, zoom, node inspection, and subflow navigation; node positions, connections, and inline configuration stay read-only. Inspecting runs never changes the editing draft.

## Responsive Behavior

- Utility panels overlay the editing canvas at all widths. Execution history and node data adapt to the available screen width.
- Up to 900px: secondary top-bar labels compact while accessible names remain available.
- Up to 760px: the header remains one row and event inspection stacks below a horizontally scrollable timeline.
- Node Studio adapts to its available content width: three columns above 860px, a node picker plus preview/editor below 860px, and a scrolling vertical layout below 640px. Resource navigation becomes an icon rail at narrower window widths; resource and workflow cards wrap to one column when needed.
- Reduced transparency preferences use solid navigation surfaces; reduced motion preferences remove transitions.

## Implementation Anchors

- Tokens and visual primitives: `apps/web/src/index.css`
- App shell and panel proportions: `apps/web/src/components/WorkflowWorkbenchLayout.tsx`
- Command hierarchy: `apps/web/src/components/WorkflowTopbar.tsx`
- Canvas and empty-state rendering: `apps/web/src/components/FlowCanvas.tsx`
- Shared card rendering and preview: `apps/web/src/components/NodeCard.tsx`, `apps/web/src/components/NodeStudio.tsx`
