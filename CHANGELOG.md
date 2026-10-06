# [0.7.0](https://github.com/99linesofcode/obsidian-project-management/compare/v0.5.1...0.7.0) (2026-10-06)


### Features

* **ci:** release the plugin the way Obsidian distributes it ([68f1b52](https://github.com/99linesofcode/obsidian-project-management/commit/68f1b525374ae602cbba2626c2d993e62b2b19ce))



## [0.5.1](https://github.com/99linesofcode/obsidian-project-management/compare/v0.5.0...v0.5.1) (2026-10-06)


### Bug Fixes

* **lint:** classify the composition root and arm the unknown-file gate ([cfdcb32](https://github.com/99linesofcode/obsidian-project-management/commit/cfdcb3275626b5f76c0b964f75472e51ed0697e1))



# [0.5.0](https://github.com/99linesofcode/obsidian-project-management/compare/v0.4.0...v0.5.0) (2026-10-06)


### Bug Fixes

* registry invariants — handle re-pointing, notePath eviction, cross-project item relocation, version-gated migrations, conformance suite (t15) ([db97b47](https://github.com/99linesofcode/obsidian-project-management/commit/db97b4764db87d8ae5d10831a60fa58f807e2190))
* the final verification findings — registry-first creation, cursor watermark, settings mutex ([75254cf](https://github.com/99linesofcode/obsidian-project-management/commit/75254cfad5da9f08d717cd146443efaf81bf3cce))
* the outward placeholder coexistence window — heal the stale placeholder, scan all refs ([22a32e8](https://github.com/99linesofcode/obsidian-project-management/commit/22a32e8a9aabc1b89674d7e17b0e881530989398))
* the probe gate discovers GitHub-side issue relations — one-time full scan per project ([f2c511a](https://github.com/99linesofcode/obsidian-project-management/commit/f2c511ae77e5f5f3a85e7785e6924f92070a343d))
* the review's blocking findings — registry integrity, settings isolation, the ladder fallback ([8f2b09d](https://github.com/99linesofcode/obsidian-project-management/commit/8f2b09da8c4afd10d19ce0c31fbb899fe28894da))


### Features

* GitHub sub-issues become Todoist subtasks via affiliation seeding (t8) ([210fea7](https://github.com/99linesofcode/obsidian-project-management/commit/210fea73511f4cbff9f44e63206fb27ae41fbbc2))
* outward materialization and project propagation across surfaces ([0eaf0f7](https://github.com/99linesofcode/obsidian-project-management/commit/0eaf0f7557b21831af427761a9b6a6f1304a1f29))
* slices never materialize in Todoist — flatten-before-delete retirement ([44d8a51](https://github.com/99linesofcode/obsidian-project-management/commit/44d8a516cf6e575db47d61df5a02c6cf50c5c7b7))
* the canonical identity core — TaskData, Mirror, the uuid registry with per-mirror bases ([fd1d220](https://github.com/99linesofcode/obsidian-project-management/commit/fd1d220e7f9c32beb973ab852babfc15d7b5f3c0))
* the project home note renamed to _<folder> ([fb3bf1d](https://github.com/99linesofcode/obsidian-project-management/commit/fb3bf1d1d7d045afb0769ad7f68a8bc4be019ed1))
* the project layer — archivedAt, the home-note convention, the dead-code sweep ([024c246](https://github.com/99linesofcode/obsidian-project-management/commit/024c2468119adad22df252aea4fb31b4dc1b4fc5))
* the vault identity layer and both sync halves on the registry ([4c4eb16](https://github.com/99linesofcode/obsidian-project-management/commit/4c4eb1608e141aa77deb5cf2dbd597848e1e74b3))



# [0.4.0](https://github.com/99linesofcode/obsidian-project-management/compare/v0.3.0...v0.4.0) (2026-10-06)


### Bug Fixes

* carry the todoist anchor through a GitHub task rewrite ([8d42d8b](https://github.com/99linesofcode/obsidian-project-management/commit/8d42d8b9621ec12c08664fa4d6d7ac866ab26ab6))
* create Todoist twins parents-before-children ([49a8c1c](https://github.com/99linesofcode/obsidian-project-management/commit/49a8c1c297e674febdd6425f9b30a5f9e2e85985)), closes [#61](https://github.com/99linesofcode/obsidian-project-management/issues/61)
* move a reopened task twin back to its lane section ([6a9895f](https://github.com/99linesofcode/obsidian-project-management/commit/6a9895faddaaa573de7818dbfa3751997c9baabd))
* resolve checklist links to the to-do's real path before projection ([f3e5fb2](https://github.com/99linesofcode/obsidian-project-management/commit/f3e5fb246f33b4b501ca31a8a0f6e5b06000f906))
* resolve short and wrong-folder checklist links before creating to-dos ([3831788](https://github.com/99linesofcode/obsidian-project-management/commit/3831788c7b5a672d9c4c137244fc25fabe1924cd))
* skip closed untracked issues on materialisation ([9af137c](https://github.com/99linesofcode/obsidian-project-management/commit/9af137c8f2f3ed14bd2013a97331fa315be74d17))
* stop completed tasks re-syncing every tick ([29cfa89](https://github.com/99linesofcode/obsidian-project-management/commit/29cfa8991c75bef06815d60ddc1a98321c959ffc))
* sweep a deleted note by deleting its board card ([c3bb803](https://github.com/99linesofcode/obsidian-project-management/commit/c3bb80328d0d8daa3b3be920b06b7340bcf65aae))


### Features

* cascade a done task onto its checklist line and to-dos ([59584e5](https://github.com/99linesofcode/obsidian-project-management/commit/59584e5e80683136b41fb55ce662c1a7e607205a))
* detect note renames from snapshot drift ([661a692](https://github.com/99linesofcode/obsidian-project-management/commit/661a692d1ec8a7637f311244afab291f3b12722f))
* name projects from their folder and accept _home.md ([fbd2e52](https://github.com/99linesofcode/obsidian-project-management/commit/fbd2e5203c6ff822e4ec092a020c79108827d327))
* serialise project syncs through one coalescing queue ([a9362df](https://github.com/99linesofcode/obsidian-project-management/commit/a9362dfe519640a37019ae02dd2550d5851b0712))



# [0.3.0](https://github.com/99linesofcode/obsidian-project-management/compare/v0.2.0...v0.3.0) (2026-09-25)


### Features

* add the Todoist token setting ([7667ccc](https://github.com/99linesofcode/obsidian-project-management/commit/7667cccce9a793341772ba9cdb2584039ef6f99f))
* apply Todoist changes and capture creations in the vault ([2667df1](https://github.com/99linesofcode/obsidian-project-management/commit/2667df10ead40d63c5452b68bb05b97bebfcc353))
* chain the to-do sync into the Todoist tick ([dba767b](https://github.com/99linesofcode/obsidian-project-management/commit/dba767b96cd0da6f3060eb2c64bf9afa933af0df))
* evict a Todoist item's record cleanly ([f584bd0](https://github.com/99linesofcode/obsidian-project-management/commit/f584bd0dcd91f42a611a1a30a1fb7a7a2bbd2c50))
* mirror project notes to Todoist projects ([2c1b4e0](https://github.com/99linesofcode/obsidian-project-management/commit/2c1b4e0a13024d7b33647c3a7f890c6375ae3da0))
* project to-dos onto their Todoist twins ([f0f69d9](https://github.com/99linesofcode/obsidian-project-management/commit/f0f69d93193f71825e6884bd407d316f56b40422))
* project tracked tasks onto their Todoist twins ([e6b801b](https://github.com/99linesofcode/obsidian-project-management/commit/e6b801bca82f4f81b6894458f6c5d68e68e4659d))
* propagate vault deletions to Todoist ([8bf75bc](https://github.com/99linesofcode/obsidian-project-management/commit/8bf75bc697ffb582083d2fcd79ae6f89ccf292eb))
* pull a task out of done when it is reopened in Todoist ([0ac2d43](https://github.com/99linesofcode/obsidian-project-management/commit/0ac2d437e3c395cf9bfafbd756a196274cb77b04))
* pull Todoist completions back into the vault ([c50d8d6](https://github.com/99linesofcode/obsidian-project-management/commit/c50d8d677abe5c7f8880769c1a878d6e22d0ecec))
* remember each Todoist item's last-synced fields ([e1d85f5](https://github.com/99linesofcode/obsidian-project-management/commit/e1d85f56325654ff742c5f79a64ff722212bb396))
* remember the last-synced completion on Todoist items ([800d4b1](https://github.com/99linesofcode/obsidian-project-management/commit/800d4b1aa07d497c7cf3c3cd95d580cd2bf6ded8))
* self-heal a twin deleted on the Todoist side ([5abe098](https://github.com/99linesofcode/obsidian-project-management/commit/5abe09877f186946036dfaba44f78453c4e190c8))
* task manager port and Todoist provider DTOs ([ce84909](https://github.com/99linesofcode/obsidian-project-management/commit/ce849096227beae5fc0077d6129585cc1ad4284d))
* Todoist REST v1 adapter ([dcdb594](https://github.com/99linesofcode/obsidian-project-management/commit/dcdb59479fd79af2a46246b77d970d087042a99f))



