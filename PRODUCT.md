# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and automation builders who create, inspect, debug, and operate node-based workflows.

## Product Purpose

Node Flow lets users compose executable workflows from typed nodes, validate their connections, configure runtime inputs, execute runs, and inspect results without leaving the workbench.

## Positioning

The product combines a visual workflow canvas with first-class node contracts, validation, execution history, credentials, environments, and package management in one local workbench.

## Operating Context

Users work primarily in a desktop browser while assembling and debugging flows. Their core loop is: find a node, place and connect it, configure it, validate, run, and inspect output or errors.

## Capabilities and Constraints

- Preserve existing workflow, node catalog, configuration, validation, save, versioning, run, credential, environment, and package-management behavior.
- The main editing surface is `apps/web/` (React, TypeScript, Vite, Tailwind, React Flow).
- API behavior and persisted workflow data must remain compatible.
- The workbench must remain keyboard-accessible, responsive, and usable with Chinese UI copy.

## Brand Commitments

- The supplied Figma workbench is the binding reference for the loaded-workflow visual direction: a dark operational canvas, semantic status colors, compact node cards, and a contextual inspector.
- The existing visual direction was established during a previous frontend redesign. New tasks take their scope and authorization from the current user request.

## Evidence on Hand

- Figma canvas: `hZ6E8ZPn84AG53kS0scqrr`, node `3:41`.
- Existing React implementation under `apps/web/`.

## Product Principles

1. The canvas is the primary workspace, not a backdrop for controls.
2. Every visible state explains what happened and what the user can do next.
3. Actions, labels, and data remain legible at operational density.
4. New users get a clear starting path without obstructing experienced users.
5. Visual semantics reinforce workflow meaning: data, decisions, warnings, and results are distinguishable at a glance.

## Accessibility & Inclusion

Maintain keyboard operation, visible focus states, semantic controls, readable Chinese typography, and non-color-only status communication.
