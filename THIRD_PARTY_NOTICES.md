Third-Party Notices
====================

`packages/dsh-meow-scope/lib/index.js` 与
`packages/workspace-scope/lib/memory/index.js` 是用 esbuild `bundle: true`
打包出来的产物，其中逐字内嵌了下列包。

每个包都是 MIT 许可，版权与许可原文随产物发布在
`packages/dsh-meow-scope/THIRD_PARTY_LICENSES/`（由 `build.mjs` 从
`node_modules` 逐个复制，构建时校验存在性）。

> 说明：本项目没有采用 `legalComments` 内联版权注释的做法，因为上述包的
> `lib/*.js` 中不存在 `/*! */`、`@license`、`@preserve` 形式的注释，
> esbuild 无从搬运；改为随包附带许可文件。

Bundled packages
----------------

### @deepseek-ai/dsh-llm 0.1.1-rc.2
- Copyright (c) 2026 DeepSeek
- Distributed source: https://github.com/deepseek-ai/deepseek-harness
- License: MIT — see `THIRD_PARTY_LICENSES/dsh-llm.LICENSE.txt`

### @deepseek-ai/dsh-timeout 0.1.1-rc.2
- Copyright (c) 2026 DeepSeek
- Distributed source: https://github.com/deepseek-ai/deepseek-harness
- License: MIT — see `THIRD_PARTY_LICENSES/dsh-timeout.LICENSE.txt`

### @deepseek-ai/schemastery 3.18.1
- Copyright (c) 2021-present Shigma
- Distributed source: https://github.com/deepseek-ai/deepseek-harness
- Upstream author: https://github.com/shigma/schemastery
- License: MIT — see `THIRD_PARTY_LICENSES/schemastery.LICENSE.txt`

### @deepseek-ai/cosmokit 1.8.6
- Copyright (c) 2021-present Shigma
- Distributed source: https://github.com/deepseek-ai/deepseek-harness
- Upstream author: https://github.com/shigma/cosmokit
- License: MIT — see `THIRD_PARTY_LICENSES/cosmokit.LICENSE.txt`

> 版权行按各包 LICENSE 原文逐字保留，未作改写（MIT 要求原样复现权利人声明）。

MIT License (applies to each package above)
-------------------------------------------

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
