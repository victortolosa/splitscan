# SplitScan Domain Model (Draft)

This is a stack-agnostic data model intended to support the MVP described in `implementation_plan.md`.
It focuses on session-based collaboration, groups/tables, items, people, allocations, and locking.

## Core Entities

### Session
Represents a single bill-splitting workspace accessed via URL.

Fields:
- `id` (string, URL-safe, opaque)
- `status` (enum: `ACTIVE`, `LOCKED`)
- `currency` (string, ISO 4217, e.g. `USD`)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `locked_at` (timestamp, nullable)
- `locked_by` (string, nullable; anonymous session id)
- `tax_total` (number, >= 0)
- `tip_total` (number, >= 0)
- `fees_total` (number, >= 0)
- `notes` (string, nullable)

### Group (Table)
A sub-bill to organize a large party.

Fields:
- `id` (string)
- `session_id` (string)
- `name` (string)
- `order` (number)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### Person
A participant in the bill.

Fields:
- `id` (string)
- `session_id` (string)
- `display_name` (string)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### GroupMembership
Many-to-many link between people and groups.

Fields:
- `id` (string)
- `session_id` (string)
- `group_id` (string)
- `person_id` (string)
- `created_at` (timestamp)

### Item
A line item on the receipt or a manually added entry.

Fields:
- `id` (string)
- `session_id` (string)
- `group_id` (string, nullable)
- `label` (string)
- `quantity` (number, default `1`)
- `unit_price` (number, >= 0)
- `total_price` (number, >= 0)
- `is_exploded` (boolean)
- `parent_item_id` (string, nullable; used for exploded items)
- `source` (enum: `OCR`, `MANUAL`)
- `created_at` (timestamp)
- `updated_at` (timestamp)

Notes:
- `total_price` SHOULD be `quantity * unit_price` for parent items.
- Exploded items have `quantity = 1` and their `parent_item_id` set.

### Allocation
Assigns an item to a person (or group) with a share weight.

Fields:
- `id` (string)
- `session_id` (string)
- `item_id` (string)
- `target_type` (enum: `PERSON`, `GROUP`)
- `target_id` (string)
- `shares` (number, integer, >= 1)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### ReceiptImage
Stored receipt image for visual verification.

Fields:
- `id` (string)
- `session_id` (string)
- `image_url` (string)
- `width` (number)
- `height` (number)
- `created_at` (timestamp)

### OcrCandidate
Temporary parsed data that must be reviewed before commit.

Fields:
- `id` (string)
- `session_id` (string)
- `raw_text` (string)
- `items` (array of `{ label, quantity, unit_price, total_price, confidence }`)
- `created_at` (timestamp)

## Derived / Computed Values
These are calculated client-side and not persisted in the MVP:
- `item_subtotal` per person
- `tax_share` per person (equal split)
- `tip_share` per person (equal split)
- `grand_total` per person

## Invariants
- When `Session.status = LOCKED`, all writes are rejected.
- `Allocation.shares` across a single item MUST sum to >= 1.
- Equal tax/tip distribution uses the count of **unique participants** in the session.

## Minimal API Operations (Real-Time)
- `create_session()` -> returns `session_id`
- `get_session(session_id)`
- `create_group(session_id, name)`
- `add_person(session_id, display_name)`
- `add_item(session_id, item)`
- `explode_item(item_id)`
- `assign_item(item_id, target_type, target_id, shares)`
- `update_fees(session_id, tax_total, tip_total, fees_total)`
- `lock_session(session_id)`

## Open Questions
- Should tax/tip be split among only participants with allocations vs. all people in the session?
- Are group-level allocations needed in MVP, or can we stick to person allocations only?
- Do we need a single "default" group when none is specified?
