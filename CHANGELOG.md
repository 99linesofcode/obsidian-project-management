# [0.14.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.13.1...0.14.0) (2026-10-08)


### Bug Fixes

* **core:** discover the project home note name-agnostically ([6bc4e72](https://github.com/99linesofcode/obsidian-project-management/commit/6bc4e72febfe17ede353a3e325dde5858400bbac))


### Features

* **core:** carry the archived timestamp through the project port ([5e4e6bb](https://github.com/99linesofcode/obsidian-project-management/commit/5e4e6bba73a7fa585ae03371bbf04ea2e33aad27))
* **core:** reconcile project lifecycle through the multi-adapter core ([2a6d99d](https://github.com/99linesofcode/obsidian-project-management/commit/2a6d99da91582d58efc63c3a750357468d04cacc))



## [0.13.1](https://github.com/99linesofcode/obsidian-project-management/compare/0.13.0...0.13.1) (2026-10-08)


### Bug Fixes

* **infrastructure:** derive the code-host board from the repository target ([2388c13](https://github.com/99linesofcode/obsidian-project-management/commit/2388c13933766e1b8a4d832e435213448978690c))



# [0.13.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.12.0...0.13.0) (2026-10-08)


### Bug Fixes

* **core:** record a failed mirror write and keep fanning out ([c210efc](https://github.com/99linesofcode/obsidian-project-management/commit/c210efc191da29290100602df7d0f18e0cb2f025))
* **core:** resolve mirror handles from note paths and namespace sides ([8e5aabc](https://github.com/99linesofcode/obsidian-project-management/commit/8e5aabc3daa857bcb5b480e958743b64ce97e775))
* **sync:** keep the multi-adapter cutover live and sweep-covered ([07f2c8e](https://github.com/99linesofcode/obsidian-project-management/commit/07f2c8e10129983d555f8a74d4872fd44d12e4eb))


### Features

* **core:** resolve mirror handles per connection ([65955a3](https://github.com/99linesofcode/obsidian-project-management/commit/65955a3dab641cb7cf4519199710d748b6d5fbb0))
* **infrastructure:** resolve mirror handles through the registry ([ae3b8c8](https://github.com/99linesofcode/obsidian-project-management/commit/ae3b8c8f16418eef0f2fea4139819bb780a2fe80))
* **settings:** add the multi-adapter engine toggle, default off ([bcb9c41](https://github.com/99linesofcode/obsidian-project-management/commit/bcb9c4170abf962543bae9c72fae54856f74acfc))
* **sync:** run the multi-adapter pass behind a setting ([4602d87](https://github.com/99linesofcode/obsidian-project-management/commit/4602d870fc049cf38839418bd0134e39571cef56))



# [0.12.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.11.0...0.12.0) (2026-10-08)


### Bug Fixes

* **eslint:** scope the vault project-source edge to the imported codec ([2ad5b6c](https://github.com/99linesofcode/obsidian-project-management/commit/2ad5b6c99db72bce895cbffc31147c9f9ffbccec))
* **registry:** keep core baselines at the data root so registry writes survive ([7240649](https://github.com/99linesofcode/obsidian-project-management/commit/72406499371156ba05f6d428939e5212030049e5))
* **registry:** reject prototype-polluting keys in the core baseline store ([6f38bc0](https://github.com/99linesofcode/obsidian-project-management/commit/6f38bc058d958c2189ce1ec994a1a5d3de2ae36c))


### Features

* **core:** add the baseline store port and its registry adapter ([9bdd84d](https://github.com/99linesofcode/obsidian-project-management/commit/9bdd84d252c4356bcc6ffba1512e0191a205d289))
* **core:** add the project source port and its vault adapter ([eb55958](https://github.com/99linesofcode/obsidian-project-management/commit/eb55958d427e4718c4b822107ad10e41da83c664))
* **core:** assemble a project pass and persist its baselines ([88561a7](https://github.com/99linesofcode/obsidian-project-management/commit/88561a7d693c5943057e125be29a29e8a6919023))



# [0.11.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.10.0...0.11.0) (2026-10-08)


### Features

* **infrastructure:** add the Todoist mirror adapter and its descriptor ([c37c897](https://github.com/99linesofcode/obsidian-project-management/commit/c37c8972589e4855736a3ba65c90969da15d378b))



