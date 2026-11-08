# Brand

18 Oct 2026, updated 7 Nov 2026. The old helmet logo, its state files, all mockups and the stand-in media were deleted ([decisions §9](../notes/decisions.md#9-brand)). Since 7 Nov the brand colour is **tomato `#ff6347`** and neon green is retired (decisions §18–19). This file keeps the rules; new files come later.

## Logo

Titan's **angry eyes**, drawn live by the bloub engine (MIT, [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub); expression `colere`), beside the wordmark **TITAN117** in Unbounded 600 (14px, 0.04em tracking, 5px from the eyes; eyes 40px on the website).

- Ink at rest (`#141414` on light, `#f2f2f3` on dark); the eyes look around on their own and turn tomato on hover.
- Reduced motion: the eyes hold still.
- Before beta, the shapes and eyes are restyled as our own (bloub recreates the x.ai avatar) and trademark-checked with the name.

## Titan's and the agents' states

The eyes' animation shows the state, always with a label too ([design.md](../notes/design.md) §2.4).

| State | bloub state | Colour |
|---|---|---|
| Idle | `idle` | Gray `#b4b4bb` |
| Working | `thinking` | The agent's colour |
| Searching the web | `comet` | The agent's colour |
| Needs approval | `notify` | The agent's colour, with a tomato "Needs you" pill |
| Done | `wink` | The agent's colour |
| Error | `alert` | Red `#e24b4a` |
| Offline | `sleep` | Gray `#8e8ea0` |

## Agent colours

Titan `#ff6347` · Folder agent `#2f6fed` · Recorder `#14a37f` · Web watcher `#8b5cf6` · App builder `#f6a825` · Code builder `#0db5ed` · QA and tests `#2a9a30` · Marketing `#ec4899` · SEO agent `#7c3aed` · Promo video `#e24b4a`. Used for the agent's eyes, dot and icon only.

## Rules

- **Reduced motion:** the eyes stop moving; the colour and label still show the state.
- **Tray icon** (Windows and macOS): static frames of the eyes, one per state.

## Media

None yet. Titan117's own images and video come later.
