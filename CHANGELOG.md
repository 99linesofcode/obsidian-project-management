# [0.16.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.15.0...0.16.0) (2026-10-08)


### Features

* **core:** adopt remote-born projects on the new sync engine ([2d3983f](https://github.com/99linesofcode/obsidian-project-management/commit/2d3983f7fafd5e23a2f2b499d4d26a2943dc25bc))



# [0.15.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.14.0...0.15.0) (2026-10-08)


### Bug Fixes

* **core:** isolate a failing connection in the lifecycle pass ([da98a3e](https://github.com/99linesofcode/obsidian-project-management/commit/da98a3e51a7a7f78688102572577247124b93a54))
* **core:** prefer the conventional home note in discovery ([61b8434](https://github.com/99linesofcode/obsidian-project-management/commit/61b8434871f917a8ba1ca592e134dfd0a344a7d6))
* **core:** reconcile a board the code-host adapter just created ([d93e7dc](https://github.com/99linesofcode/obsidian-project-management/commit/d93e7dccbef5e0a6b42e6a88ce31e72ed8d8d03a))
* **sync:** snapshot the reconcilers once per execute ([733c0c3](https://github.com/99linesofcode/obsidian-project-management/commit/733c0c3767097836122495ae353a737456917be6))


### Features

* **core:** onboard a newly-connected project's mirror ([8a42acb](https://github.com/99linesofcode/obsidian-project-management/commit/8a42acb57805f204954c9e02a32cb7573b83fab5))
* **core:** sync a project whose home note still has a legacy name ([65ed2b3](https://github.com/99linesofcode/obsidian-project-management/commit/65ed2b34dfba59cead6af3a9594cca8232699282))
* **sync:** migrate the project home note on the gated new path ([6708935](https://github.com/99linesofcode/obsidian-project-management/commit/67089358f07f4651bc3c7d7a4c2ef1c18617f2d9))



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



