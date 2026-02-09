# Sprint 1 Backlog (Draft)

Goal: Core environment setup, anonymous session logic, and URL-based data fetching.

## Setup
- Choose tech stack (frontend + real-time backend)
- Initialize project scaffolding
- Define env/config loading
- Set up lint/format/test baseline

## Session & Routing
- Generate URL-safe session IDs
- Create session on "New Bill"
- Load session by URL ID
- Anonymous presence identity per client

## Data Layer
- Session read/write
- Basic real-time sync for `Session`, `Person`, `Item`
- Locking rules (reject writes when locked)

## UI (Minimal)
- Landing: Create + Join
- Empty workspace with session title
- Basic list render for people + items

## Acceptance Checks
- Two clients on same URL see changes live
- Refresh keeps session state
- Locking stops edits for all clients
