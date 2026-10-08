# [0.18.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.17.0...0.18.0) (2026-10-08)


### Bug Fixes

* **core:** record a task's mirror handle before creating the item ([820928c](https://github.com/99linesofcode/obsidian-project-management/commit/820928c5a8631518847a8b55680cb578ae72648b))
* **vault:** materialize only typed task notes ([6d398b6](https://github.com/99linesofcode/obsidian-project-management/commit/6d398b6e9a7266b52d4887ac764475f1363673b0))
* **vault:** stop passing the vault link as the mirror's parent ([bb20b0b](https://github.com/99linesofcode/obsidian-project-management/commit/bb20b0b4058f15f5993c0baf2473cd0a6c3589d8))


### Features

* **core:** create a vault task note's missing mirror item ([12ad30d](https://github.com/99linesofcode/obsidian-project-management/commit/12ad30d69e56f0a36e164fa186fd2800e9178d17))



# [0.17.0](https://github.com/99linesofcode/obsidian-project-management/compare/0.16.0...0.17.0) (2026-10-08)


### Bug Fixes

* **core:** scan the whole task listing and isolate failing connections ([6b3a1f0](https://github.com/99linesofcode/obsidian-project-management/commit/6b3a1f0a9ae5a996b1ecf0439d102ba7d04b4c6c))
* **todoist:** capture completed tasks alongside active ones ([5ec5842](https://github.com/99linesofcode/obsidian-project-management/commit/5ec5842557b6962d58534e9937ee49996aedccd9))


### Features

* **core:** adopt application-born tasks on the new sync engine ([7f4ec1e](https://github.com/99linesofcode/obsidian-project-management/commit/7f4ec1e81242d8f0577191e8408ed8fc03672c80))



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



