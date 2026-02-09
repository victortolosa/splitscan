# SplitScan: App Architecture & Feature Specification
SplitScan is a utility-focused web application designed to automate and simplify the process of splitting group bills. This specification outlines the functional screens, user actions, and the collaborative data model.
## 1. Access & Collaboration Model
SplitScan utilizes a decentralized, session-based access model to eliminate the friction of user accounts.
URL-as-Key: Every bill is associated with a unique, obfuscated ID generated upon creation. This ID is embedded in the URL.
Stateless Authentication: Users are authenticated anonymously at the session level. No personal data (email, name, social login) is required to view or edit.
Real-Time Sync: The application uses a "Single Source of Truth" cloud database. Any modification made by one user (e.g., adding an item, assigning a person) is instantly reflected for all other users on the same URL.
Hierarchical Organization: Supports organizing a single session into multiple Groups or Tables. This allows large parties to manage separate sub-bills within one collaborative session.
Multi-State Navigation:
Active Workspace & Audit: A unified live-editing environment where users manage items, people, and groups while viewing real-time audit calculations.
Final Confirmation: A simplified, locked-down "Digital Receipt" for final agreement and payment.
## 2. Screen Architecture
A. Entry & Landing
The entry point serves to either initialize a new session or join an existing one via a shared link.
Primary Action: Create a new bill.
Secondary Action: Join via recent history or shared link.
B. Scanner & Parsing Review
A two-step interface for capturing and verifying raw receipt data.
Phase 1 (Capture): Live camera viewfinder with image capture. Triggers the local OCR pipeline.
Phase 2 (Verification): A dedicated "Review" overlay that appears before items hit the main workspace.
Correction UI: Users can tap parsed text or prices to correct OCR hallucinations immediately.
Validation: Visual indicators (e.g., green/red highlights) showing the engine's confidence in specific price points.
Image Retention: The high-resolution source image is preserved and synced to the session for visual reference.
C. Collaborative Workspace & Audit View
A comprehensive, unified engine for managing and verifying the bill in real-time.
Management Layer:
Group/Table Management: Create or move entities between sub-groups.
Item Management & Explosion: - Dynamic list of items with real-time editing.
"Explode" Feature: A specialized action for entries with quantities (e.g., "4x Draft Beer"). One tap splits the bulk entry into 4 individual line items for separate assignment.
People Management: Global participant list and assignment logic.
Visual Reference (Receipt Viewer):
Toggle Viewer: A floating button or persistent thumbnail that opens the original receipt image.
Zoom & Pan: A full-screen modal interface allowing users to pinch-to-zoom or drag-to-pan across the original photo.
Audit Layer (Integrated):
Real-Time Transparency: Visual "audit trail" beneath items.
Live Fee Breakdown: Persistent summary panel for tax/tip distribution.
Finalization Action: "Lock & Finalize" button to transition to the read-only Confirmation state.
D. Final Confirmation (The "Receipt" View)
A super-simple, immutable screen designed for the final "handshake" between friends.
Zero-Edit Interface: All inputs and management controls are removed. The UI is completely non-interactive.
Final Tally: A minimalist list displaying only Person Name and Total Amount Owed.
Grand Total: Prominent display of the total bill amount including all fees.
Action: "Copy Summary" text and an "Unlock to Edit" fallback.
## 3. Key Functional Features
Local OCR Processing: Text extraction happens on the user's device for privacy.
OCR Verification Step: A mandatory review phase that prevents "dirty data" from entering the workspace, allowing users to cross-reference the zoomable source image while confirming the parsed text.
Line-Item Explosion: Automatically detects quantity patterns (e.g., "3 Sodas") or allows manual "unbundling" of items into individual entries for granular splitting.
Visual Grounding: The original receipt image is stored and remains accessible in the workspace for manual verification.
Hierarchical Weighting: Supports complex nested splits and group-level assignments.
Equal Tax/Tip Distribution: Fees are split exactly: every participant pays an identical share of the tax and tip.
Session Locking: Transitioning to the Confirmation screen triggers an "Immutable Mode" across all connected clients.
## 4. Universal Design Principles
Mobile-First Utility: Optimized for one-handed operation.
Interactive Image Inspection: High-fidelity touch controls for zooming into the receipt photo.
Glanceable Totals: Real-time subtotal and tax/tip feedback are always visible.
Frictionless Sharing: Direct URL sharing for editing and dedicated "Share Tally" buttons for the final receipt.
## 5. Project Roadmap: Epics & Sprints
Progress (as of February 9, 2026):

### Epic 1: Collaboration Engine & Foundation
| Sprint | Focus | Status | Notes |
| --- | --- | --- | --- |
| 1 | Core environment setup, anonymous session logic, URL-based data fetching | Completed | React/Vite scaffold, URL routing, anonymous client IDs, session create/join flows, local mode fallback |
| 2 | Manual entry systems and real-time database integration | Completed | People/items/groups CRUD, realtime Firestore + local BroadcastChannel sync, lock enforcement via Firestore rules |

### Epic 2: Intelligence & Parsing (OCR)
| Sprint | Focus | Status | Notes |
| --- | --- | --- | --- |
| 3 | Local OCR engine integration and image preprocessing pipeline | Completed | Scanner route, local Tesseract OCR, camera + file upload capture |
| 4 | Parsing review UI, quantity detection, image persistence system | Completed | Review UI with confidence flags, quantity heuristics, receipt persistence (Firestore + Storage) |

### Epic 3: Entity Hierarchy & Splitting Logic
| Sprint | Focus | Status | Notes |
| --- | --- | --- | --- |
| 5 | Group/Table data models and item explosion logic | Completed | Group CRUD, group assignment, item explosion workflow |
| 6 | Equal split algorithm and hierarchical assignments | In progress | Person-level allocations, per-person totals, fee inputs with equal fee split; group-level assignments not implemented |

### Epic 4: Quality & Delivery
| Sprint | Focus | Status | Notes |
| --- | --- | --- | --- |
| 7 | Unified workspace UI with zoomable receipt viewer & final confirmation screen | In progress | Workspace UI and receipt viewer modal exist; final confirmation screen missing |
| 8 | Performance audit, interaction polish, mobile browser compatibility | Not started |  |
