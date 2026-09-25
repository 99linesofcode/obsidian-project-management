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



# [0.2.0](https://github.com/99linesofcode/obsidian-project-management/compare/v0.1.1...v0.2.0) (2026-09-24)


### Bug Fixes

* board cards for new issues, placed in the right lane ([d1991fc](https://github.com/99linesofcode/obsidian-project-management/commit/d1991fc69a0273643a64ab97b0a7d5bfb23679e0))
* reconcile archive state through a three-way baseline merge ([7bf5d8b](https://github.com/99linesofcode/obsidian-project-management/commit/7bf5d8bf74f646fed85bb3cff49d3f14764e6a05))
* route created notes through the checklist sync chain ([27bd0e3](https://github.com/99linesofcode/obsidian-project-management/commit/27bd0e3681a2a0aee97afdb15fe0d02fe3ab6184))


### Features

* archive projects by folder location, mirrored to the board ([cd7e181](https://github.com/99linesofcode/obsidian-project-management/commit/cd7e1819768c20b066eccee7d7dc5e11cdd2ce8c))
* follow to-do and task-note renames ([88d3251](https://github.com/99linesofcode/obsidian-project-management/commit/88d325199db056109b5ce7612753bada99925dfc))
* lock unshipped issue conversations when a project archives ([80cdb4f](https://github.com/99linesofcode/obsidian-project-management/commit/80cdb4fa2fe9bac36a2fd3cbeb75cdddf7c0664e))
* probe project state before fetching boards ([23cbb97](https://github.com/99linesofcode/obsidian-project-management/commit/23cbb97c3419ddea205ee305b51b1edba11c12a3))
* project checklist links between vault notes and issue bodies ([abb4216](https://github.com/99linesofcode/obsidian-project-management/commit/abb4216dd36ff11863b95dc3c4ed5f4c51c03d61))
* propagate checklist text changes to the linked to-do ([82ab238](https://github.com/99linesofcode/obsidian-project-management/commit/82ab23848fc1bee6d3cdb6758436cec8ddc686f1))
* reconcile the full tracked issue set on every poll ([59aa1e5](https://github.com/99linesofcode/obsidian-project-management/commit/59aa1e56a6bd0e47d37ca0837dc344390bd6d4cd))
* render task notes from a configurable template ([b1479e7](https://github.com/99linesofcode/obsidian-project-management/commit/b1479e78e1a259b137a34133295c3c670c0720bd))
* sync every typed issue, not only tasks ([e0d90f9](https://github.com/99linesofcode/obsidian-project-management/commit/e0d90f93c34662a968c47c2eaa5cceff6be69c92))
* sync task-note checklists with vault to-dos ([914e591](https://github.com/99linesofcode/obsidian-project-management/commit/914e59111146f7230345b8e8a56201e778f4015f))
* to-do note domain layer (checklist parser, mapper, parser) ([e97dde0](https://github.com/99linesofcode/obsidian-project-management/commit/e97dde075c1cf20c1265f34889f219ab4f0be074))
* to-do notes carry the Todos.base category and datetime completion ([6995255](https://github.com/99linesofcode/obsidian-project-management/commit/6995255777c3810470d5aa002679ea087f71448e))
* watch archived repositories and re-activate on new issues ([3278089](https://github.com/99linesofcode/obsidian-project-management/commit/3278089536fda83e70561a8d54b713de82fea556))



## [0.1.1](https://github.com/99linesofcode/obsidian-project-management/compare/v0.1.0...v0.1.1) (2026-09-24)


### Bug Fixes

* **deps:** bump devshell from `27205da` to `231cbce` ([#35](https://github.com/99linesofcode/obsidian-project-management/issues/35)) ([dabda91](https://github.com/99linesofcode/obsidian-project-management/commit/dabda91225726e2e84d34f686ddfe803c201308b))



# [0.1.0](https://github.com/99linesofcode/obsidian-project-management/compare/6eed1fe2dc2ec35e50a0aca1e130381c23ac2a9e...v0.1.0) (2026-09-21)


### Bug Fixes

* a new project's notes materialize on its first sync ([2f5d3dd](https://github.com/99linesofcode/obsidian-project-management/commit/2f5d3dd117bffa19f3a1b7d1269b8a44839b414e))
* create missing folders when materializing task notes ([50d8e0b](https://github.com/99linesofcode/obsidian-project-management/commit/50d8e0bb24b30ba826d503e1e73c82fd1b209216))
* the plugin loads again — no more crash on a missing repo url ([09c91cf](https://github.com/99linesofcode/obsidian-project-management/commit/09c91cf7a28279dc6835093f1f48b601a6dcd04b))


### Features

* attach a project — resolve repo + board identities (UC1) ([#2](https://github.com/99linesofcode/obsidian-project-management/issues/2)) ([9e54c9a](https://github.com/99linesofcode/obsidian-project-management/commit/9e54c9aaf2a921132e11dbe685bb7b12c9f38f81))
* build as esmodule for nodenext ([e17541f](https://github.com/99linesofcode/obsidian-project-management/commit/e17541ff4609b21e6b3abf5083d8316461bcd57f))
* close or reopen a task's GitHub issue from its note status (UC6) ([#7](https://github.com/99linesofcode/obsidian-project-management/issues/7)) ([188cc23](https://github.com/99linesofcode/obsidian-project-management/commit/188cc23ed54ca3d6d8f189f8f782a727c700861b))
* find the vault's synced projects automatically (project discovery) ([#19](https://github.com/99linesofcode/obsidian-project-management/issues/19)) ([b1aafda](https://github.com/99linesofcode/obsidian-project-management/commit/b1aafdaaa0a6d1918a84521b235451499596ce3c))
* github actions dependabot workflow ([8b4e02a](https://github.com/99linesofcode/obsidian-project-management/commit/8b4e02ace71a13e2fcd6a247061567548917f154))
* hello world ([6eed1fe](https://github.com/99linesofcode/obsidian-project-management/commit/6eed1fe2dc2ec35e50a0aca1e130381c23ac2a9e))
* keep task notes in step with GitHub automatically (UC3) ([#4](https://github.com/99linesofcode/obsidian-project-management/issues/4)) ([5e6df4a](https://github.com/99linesofcode/obsidian-project-management/commit/5e6df4ae355623fd2fc5914efd5c1d861f68a6a3))
* materialise a task note from a promoted issue (UC2) ([#3](https://github.com/99linesofcode/obsidian-project-management/issues/3)) ([4d3ff0a](https://github.com/99linesofcode/obsidian-project-management/commit/4d3ff0abca837d3b23287641e9ec5bb5ba3dc7c5))
* mirror the board status column and let it drive the issue and note (UC7-UC9) ([#8](https://github.com/99linesofcode/obsidian-project-management/issues/8)) ([ac9a4ff](https://github.com/99linesofcode/obsidian-project-management/commit/ac9a4ff64b7f5b7baddfd8732d9a230ee9e82e3f))
* obsidian plugin shell with settings ([#1](https://github.com/99linesofcode/obsidian-project-management/issues/1)) ([71e65ce](https://github.com/99linesofcode/obsidian-project-management/commit/71e65cec1696e8652f2f91dfe3665dfc07dc1f6d))
* project status names lead — notes carry the board's lanes ([a12d420](https://github.com/99linesofcode/obsidian-project-management/commit/a12d420310a7c27ad0f9661d96177ca3484e3792))
* promote a draft card on the board into a GitHub issue from Obsidian (UC11) ([#10](https://github.com/99linesofcode/obsidian-project-management/issues/10)) ([40900a9](https://github.com/99linesofcode/obsidian-project-management/commit/40900a932640d4eb73f7534930f853c4ed017f37))
* promote a GitHub issue into a tracked task from Obsidian (UC10) ([#9](https://github.com/99linesofcode/obsidian-project-management/issues/9)) ([b0634ff](https://github.com/99linesofcode/obsidian-project-management/commit/b0634fff30e58d06faadcf8de3a12a552da8558e))
* push note edits onto their GitHub issues automatically (UC4) ([#6](https://github.com/99linesofcode/obsidian-project-management/issues/6)) ([137c52c](https://github.com/99linesofcode/obsidian-project-management/commit/137c52c844fa3c6565049f3da8ceb6bdd8579da3))
* reconcile competing note and remote edits, note wins (UC5) ([#5](https://github.com/99linesofcode/obsidian-project-management/issues/5)) ([b560623](https://github.com/99linesofcode/obsidian-project-management/commit/b5606230c89bd8c8007edb2b66a167ddc5d9e241))
* sync only tasks that carry a type label ([ed06c91](https://github.com/99linesofcode/obsidian-project-management/commit/ed06c9151f4df6416930d8f4bff55eec9d66935e))
* use the spaced type: task / type: slice label convention ([1989b68](https://github.com/99linesofcode/obsidian-project-management/commit/1989b68673314ff0d1c9520464cc84d1a1812d56))



