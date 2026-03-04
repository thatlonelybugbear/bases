## v13.351.4 - 2026-03-04
* Added a supported systems changelog section.
* Supported systems (current):
  * Daggerheart
  * DnD5e
  * DnD4e
  * PF2e
  * Crucible
  * Mosh
* Known incompatibilities:
  * Draw Steel (by design, system already provides similar functionality)
* Known issues:
  * DnD4e and Crucible can show truncated labels in tighter layouts; built-in tooltips are available on hover.
  * DC20 labels can truncate in narrow column layouts; follow-up: add overflow tooltip for truncated labels (and/or optional wider column min width for wrapper-based systems).

## v13.351.3 - 2026-01-26
* Initial public release.
* Added incompatibility handling for Draw Steel system
  * Community testing and feedback would be appreciated to help identify other incompatible systems or cases that may require system-specific handling
* Fixed an issue where status effect names could wrap incorrectly in the token HUD.

## v13.351.2 - 2026-01-25
* Fixed an issue where status effects would be without a label in some systems.

## v13.351.1 - 2026-01-25
* Initial release of "Bugbear's Assign Status Effects Sorter" for Foundry VTT 13.351.
