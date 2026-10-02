# 悬浮莉莉丝抠图素材 · 来源说明（1.0.0）

本目录是手机悬浮莉莉丝（`src/lilith-float.js`，设置 → 悬浮莉莉丝）的透明素材，由
`tools/lilith_float_cutout.py` 从仓库里已有的原版素材生成，坐标常量写在 `src/lilith-float-art.js`。

## 输入

| 输入 | 说明 |
| --- | --- |
| `vendor/original/assistant-v1.1.js` 中的 `ZhuTianLilithLayers` | 原版 v1.1 的 636×948 分层立绘：plate 背景、wings、tail、body、faces 表情补丁。**原作者素材**，版权归原作者。 |
| `assets/lilith/variants/sad.webp` | 委屈表情：原版分层里没有，取自 AI 差分立绘的脸部（见 `assets/lilith/variants/PROVENANCE.md`）。 |
| 抠图模型 `isnet-anime.onnx` | rembg 发布的动漫人物分割模型（<https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx>），只在生成时使用，**不随仓库分发**。 |

## 处理

1. plate + wings + tail + body 合成整图，交给 isnet-anime 得到人物蒙版。
2. 单用模型会丢掉翅膀、留下紫雾：body 图层自带的 alpha 与模型蒙版取较小值，再做色阶（0.45–0.90）去掉背景残留。
3. 只取头到大腿上部 `(0,0)-(636,700)`，底部 22% 羽化渐隐，悬浮时没有硬切边。
4. 两只翅膀单独导出（各有转轴，悬浮时轻轻扇动）；表情补丁按原版坐标原样导出（委屈表情按脸部对齐）。
5. 全部为 WebP（带透明通道）。没有用任何图像模型重新绘制人物；像素都来自原版分层或已有的差分立绘。

重新生成：`python3 tools/lilith_float_cutout.py /path/to/isnet-anime.onnx`（需要 `onnxruntime`、`numpy`、`Pillow`）。

## 文件与校验

| 文件 | 尺寸 | sha256 |
| --- | --- | --- |
| `body.webp` | 636×700 | `35c0aabfd4f268f68680c1f54e405442d1c20b2e79a280b2325e2b036177c1db` |
| `face-blink.webp` | 126×58 | `47aa2d0ddf25fb55a8d82c0366d499092fb403be70bb7111ea57077758641652` |
| `face-pout.webp` | 147×127 | `a1bfbe28b6b2c8d20ae292efe574b5bc8ae95bd5e272194edb51e3c8aae5c835` |
| `face-sad.webp` | 148×128 | `4e6bc9564a015e4365b1b51d7baaace62c8eda85a055c26c1df93b38b368b1d8` |
| `face-shy.webp` | 148×128 | `4f468b67a93bb7a1f17f15bbf7b864b45e7b0e85c5ee7c39a1d5a03caaf303eb` |
| `face-smile.webp` | 126×121 | `ab0c8198c49d96455cbfe7af7b47ff585690c00ec99109eff9cd9a66bedf89c4` |
| `face-smug.webp` | 147×128 | `d6c717d6da8fd1d79c87c6da2170ebaf8b29ab7a52d01532f5151d0f27c85fd0` |
| `face-surprised.webp` | 129×127 | `0382929ef15bcc2bcfdccfaf79697c61d3d18e5c5725a044bfad0f907833ee6a` |
| `face-talk.webp` | 133×58 | `a25b0459c43ea557c4796bd1cd7c5435383bb66f8b8c673f62b59b42c80f1ee4` |
| `face-wink.webp` | 147×127 | `235a7e95d127ea14a4c6e3390684658ac4315ff1815928ba7cb06a33acceb308` |
| `wingl.webp` | 100×391 | `69fcab77c6bab5f7b766f36ddbeaa4c94a04c5719f665f2ad3afb1ac2ca5bf1f` |
| `wingr.webp` | 130×561 | `47f4e573e4498aaf36ec3251cbf0db2cb7c636e91078b734ee8e4f6898e230fe` |

`tests/v100.test.js` 会逐一核对上表的 sha256。素材的使用条件见仓库根目录 `LICENSE`：原版立绘的权利仍归原作者，
本插件只在安装使用时显示，不得单独提取再分发。
