## v14.363.1 - 2026-05-30

- Reworked CSS when the Status Effect Sorter is enabled, to match the Foundry UI layout more closely.
- Verified compatibility with Foundry VTT 14.363.

## v13.351.5.6 - 2026-03-31

- Narrorer css selector

## v13.351.5.4 - 2026-03-27

- Added Polish translation by [Lioheart](<https://github.com/Lioheart>) 🤗

## v13.351.5.3 - 2026-03-18

- Fix for attribute bar 1 being misplaced!

## v13.351.5.2 - 2026-03-06

- Ported Bugbear Mechanics 5e's Foundry `SearchFilter`-based Status HUD filtering flow into BASES, including clean-query normalization and bound filter lifecycle handling.

## v13.351.5.1 - 2026-03-05

- Fixed dnd5e `Exhaustion` / `Concentration` handling when clicking or right-clicking wrapper-based filtered rows by forwarding wrapper interactions to the native inner control.

## v13.351.5 - 2026-03-05

- Status HUD now supports module-injected temporary/custom effects in a system-agnostic way.
- Filter keyboard flow now supports: `Enter` to trigger first visible match, `Escape` to clear, and `Escape` on empty input to close the effects palette.
- Opening the effects palette now auto-focuses the filter input, and filtered effect toggles (Enter or mouse click/right-click) restore filter focus after re-render.
- Filter clear control is now an inline `X` inside the input, shown only when text exists; clicking it clears the field and keeps focus for continued typing.

## v13.351.4 - 2026-03-04

- Added Filter effects field for quick search
- Supported systems (current):
  - Crucible
  - Daggerheart
  - DC20
  - DnD4e
  - DnD5e
  - Mosh
  - PF2e
- Known incompatibilities:
  - Draw Steel (by design, system already provides similar functionality)

## v13.351.3 - 2026-01-26

- Initial public release.
- Added incompatibility handling for Draw Steel system
  - Community testing and feedback would be appreciated to help identify other incompatible systems or cases that may require system-specific handling
- Fixed an issue where status effect names could wrap incorrectly in the token HUD.

## v13.351.2 - 2026-01-25

- Fixed an issue where status effects would be without a label in some systems.

## v13.351.1 - 2026-01-25

- Initial release of "Bugbear's Assign Status Effects Sorter" for Foundry VTT 13.351.
