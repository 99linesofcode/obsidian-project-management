# [0.8.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.7.0...0.8.0) (2026-10-07)


### Bug Fixes

* **app:** await the modal open and type the choose event ([5158261](https://github.com/99linesofcode/obsidian-project-management/commit/5158261848dca4a8b418a19ba2dd47ef28f0c102))
* **deps:** bump devshell from `231cbce` to `81a5ee1` ([#76](https://github.com/99linesofcode/obsidian-project-management/issues/76)) ([768a41c](https://github.com/99linesofcode/obsidian-project-management/commit/768a41c05e59d748bdd20b6b0433e093531a1554))
* make the connection model real end to end ([2b6de3f](https://github.com/99linesofcode/obsidian-project-management/commit/2b6de3ffc89b8a8ed8ec78db244045d49cd2ce99)), closes [#84](https://github.com/99linesofcode/obsidian-project-management/issues/84)
* **todoist:** send requests through Obsidian requestUrl ([0c46167](https://github.com/99linesofcode/obsidian-project-management/commit/0c461671c3a1df796aaf8a3e15b7fe87e4a34779))
* **vault:** trash notes through FileManager.trashFile ([a1c27dd](https://github.com/99linesofcode/obsidian-project-management/commit/a1c27ddff88c5b92cf729ff46dae05d5b6c64cd0))


### Features

* capture projects into the connection envelope ([bdddb2b](https://github.com/99linesofcode/obsidian-project-management/commit/bdddb2b16073daccde534b167bad0f14de32357b))
* **core:** add the capability vocabulary, canonical DTOs and ports ([2130115](https://github.com/99linesofcode/obsidian-project-management/commit/2130115c75d33ac96892998b4f3adc8aa267cf62))
* **core:** add the generic mirror-sync action ([7e79763](https://github.com/99linesofcode/obsidian-project-management/commit/7e79763a0f315a8e34d284e609886c9b17c4c5f3))
* **core:** add the neutral adapter registrar ([ef2d41b](https://github.com/99linesofcode/obsidian-project-management/commit/ef2d41b6046c4ac2d988d9154fca4e661222b668))
* **core:** add the single pure N-way merge ([f7a5a43](https://github.com/99linesofcode/obsidian-project-management/commit/f7a5a43fce866d3633deb67e1815d0e5f1ceeecd))
* declare tool connections in project frontmatter ([05a2147](https://github.com/99linesofcode/obsidian-project-management/commit/05a2147c01f6d0022db52ab4f2214e3fc072d347))
* **infrastructure:** add the conformance mirror adapter ([54d6e4a](https://github.com/99linesofcode/obsidian-project-management/commit/54d6e4a2ca61fad174a49e58a596bccf5f59f780))
* **main:** register the conformance adapter at the composition root ([31c3a18](https://github.com/99linesofcode/obsidian-project-management/commit/31c3a1825263ccb57c385ce9cf74a7a43f43f6d2))
* migrate archived project connections ([8a29007](https://github.com/99linesofcode/obsidian-project-management/commit/8a29007bc0183f285e5aee91cac0a35c48b3e44b))
* **projects:** derive the GitHub board from the repository ([8e3a4e1](https://github.com/99linesofcode/obsidian-project-management/commit/8e3a4e1af4506b07ae588b2ddb60378a4c3ae9a7))
* seed vault templates and bases on first run ([895073a](https://github.com/99linesofcode/obsidian-project-management/commit/895073a79a540a532278f38d7f8585155f98bd77))
* **settings:** expose declarative setting definitions ([2f3d528](https://github.com/99linesofcode/obsidian-project-management/commit/2f3d52849b04aa3bb9899b349cc04007bdda9bd3))
* store API tokens in Obsidian SecretStorage ([5d5428f](https://github.com/99linesofcode/obsidian-project-management/commit/5d5428f646545b0e10409276a8d23988ee5f2665))



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



