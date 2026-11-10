# Core Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a testable web and driver application for authentication, vehicle/driver records, dispatch, authorized tracking, and photo attendance.

**Architecture:** Vite React dashboard and Expo driver app use Supabase Auth/Postgres/Storage. Database RLS and RPCs guard all writes and reads. Cloudflare Pages hosts the dashboard.

**Tech Stack:** TypeScript, React, Vite, Expo, Supabase, PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-10-core-operations-design.md`

## Global Constraints

- Timezone: Asia/Manila. Server receipt time is authoritative.
- No fake operational data or successful placeholder actions.
- Never expose service-role credentials to either client.
- Tracking is explicit, assigned-trip only, and stale locations are labeled.

## Review Focus

- A driver cannot see another driver's trip or attendance.
- A dispatcher cannot assign a busy truck or driver.
- Location writes after tracking stops or trip completion fail.
- An attendance photo is private and its record has a server timestamp.
- Bad or missing GPS permissions show a clear error.

## Tasks

### 1. Database and access

- [x] Write migration with entities, constraints, indexes, RLS, private storage, and guarded RPCs.
- [x] Add a PostgreSQL smoke test covering unauthorized access, conflicts, and tracking-session checks.
- [x] Document owner bootstrap and local Supabase setup.

### 2. Office dashboard

- [x] Write tests for small status/time helpers, confirm they fail, then implement them.
- [x] Build sign-in, role-aware navigation, vehicle and driver create/edit/deactivate, dispatch creation/cancellation, live last-known list/map, and HR attendance review.
- [x] Verify strict TypeScript and production build.

### 3. Driver application

- [x] Build sign-in and assigned trip views, status updates, tracking controls and background task, and photo attendance submission.
- [x] Verify TypeScript, Expo configuration, and Android bundle export. Document development-build requirement.

### 4. Test hosting

- [x] Add environment templates, README, and free-tier comparison with current source links.
- [x] Run available tests/builds and record what requires real credentials or a device.

Live Supabase, email, device, and hosted deployment checks remain pending until project credentials and a physical test device are available.
