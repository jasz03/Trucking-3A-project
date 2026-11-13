# Quotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save and approve transparent trucking quotes, then convert accepted quotes into guarded dispatches.

**Architecture:** PostgreSQL functions calculate and transition quotes; the React dashboard provides the forms and printable document.

**Tech Stack:** PostgreSQL, PGlite tests, React, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-13-quotations-design.md`

## Global Constraints

- PHP currency and Asia/Manila display.
- Manual estimates are labeled as estimates.
- No hardcoded rate, tax, or toll assumptions.
- Quote conversion is atomic and uses existing dispatch guards.

## Review Focus

- Negative amounts and zero distance are rejected.
- Price snapshots remain unchanged when the rate card changes.
- A dispatcher cannot approve their own quote through a direct update.
- One accepted quote converts at most once; a failed multi-truck conversion leaves no trips.
- Quotes do not appear as collected revenue.

## Tasks

- [x] Write failing database tests for rate calculation, approval, and conversion.
- [x] Add rate cards, quotations, line items, events, RLS, and guarded functions.
- [x] Add quote and rate-card screens with a printable PDF layout.
- [x] Run database tests, strict typecheck, and production build.
