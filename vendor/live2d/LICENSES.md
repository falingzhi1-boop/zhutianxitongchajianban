# vendor/live2d 第三方组件与许可证

本目录只包含**可自由再分发**的开源部分。Live2D 的专有运行库 **Cubism Core 没有打包**，需要用户自行获取。

| 文件 | 来源 | 版本 | 许可证 | SHA-256 |
| --- | --- | --- | --- | --- |
| `pixi.min.js` | npm `pixi.js`（`dist/pixi.min.js`） | 6.5.10 | MIT | `403f2f2ee8145fa17f60c5c89403056efe2680e5096ec2762036486914ed19c5` |
| `cubism4.min.js` | npm `pixi-live2d-display`（`dist/cubism4.min.js`） | 0.4.0 | MIT（内含 Live2D Cubism Framework，见下文） | `af1267e6d52759b245766c578d905bfa025b532d5c3cc727c370957c4409e21b` |

## Cubism Core（未打包）

- `live2dcubismcore.min.js` 是 Live2D Inc. 的专有软件，受 **Live2D Proprietary Software License Agreement** 约束：
  <https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html>
- 本扩展**不分发** Core。用户在设置里勾选同意许可后，扩展才会从 `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`
  或用户自己填写的地址（例如放在酒馆 `data/<用户>/user/files/` 里的副本）加载它；没有勾选时不会发出任何请求。
- 官方下载页：<https://www.live2d.com/download/cubism-sdk/download-web/>。pixi-live2d-display 的文档也说明官方直链“不保证适合生产环境”，
  长期使用建议下载后放进 `user/files`。

## Live2D Cubism Framework

`cubism4.min.js` 打包了 Live2D Cubism SDK for Web 的 **Framework** 部分（开源组件），其使用条款为
**Live2D Open Software License Agreement**：<https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html>。
在自己的作品中使用 Live2D 模型发布时，还要遵守 Live2D 的 **SDK Release License**
（<https://www.live2d.com/en/sdk/license/>）：年营业额低于 1000 万日元的个人/小规模事业者通常可免费发布，其余情况需与 Live2D 签约。
本扩展本身不附带任何 `.moc3` 模型；用户自己加载的模型，其版权和使用条款由模型作者决定。

## 测试用模型

浏览器验收使用 Live2D 官方示例模型 “Haru”（`haru_greeter_t03`），只放在隔离测试宿主的 `user/files` 目录里，**没有提交到本仓库**。

---

## pixi.js 6.5.10 — MIT

```
The MIT License

Copyright (c) 2013-2017 Mathew Groves, Chad Engler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## pixi-live2d-display 0.4.0 — MIT

```
MIT License

Copyright (c) 2020 Guan

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
```
