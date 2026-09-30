# 莉莉丝 AI 差分立绘 · 来源说明

本目录的图像用于 `portrait.mode = "variants"`（设置 → 莉莉丝立绘 → AI 差分立绘）。
除 `neutral.webp` 外，均为 **AI 图像模型生成 / 编辑** 后再经脚本处理的衍生图，基于原版立绘 `assets/original/lilith.webp`（424×632）。

## 表情差分（全画幅，含原背景）

| 文件 | 表情 | 生成方式 |
| --- | --- | --- |
| `neutral.webp` | 平静 | 原版立绘原样重编码，**非 AI** |
| `smile.webp` | 微笑 | AI 编辑脸部裁切 → 合成回原图 |
| `shy.webp` | 害羞 | 同上 |
| `pout.webp` | 嘟嘴 | 同上 |
| `surprised.webp` | 惊讶 | 同上 |
| `wink.webp` | 眨眼 | 同上 |
| `smug.webp` | 坏笑 | 同上 |
| `sad.webp` | 委屈 | 同上 |

流程（`tools/lilith_variants_compose.py`）：

1. 从原图裁出脸部区域 `(118,30)-(278,190)`，放大到 640² 交给图像模型，只改表情。
2. 在脸部椭圆**以外**（头发、角、耳朵）用 ORB 特征 + RANSAC 相似变换把生成图对齐回原图坐标；
   本批 7 张的内点数都在 252–284 之间，变换接近恒等（缩放 0.999–1.000，平移 ≤0.3px）。
3. 在脸周环带内按 LAB 均值/方差做色彩匹配，缩回原分辨率，用高斯羽化椭圆蒙版只替换脸部。
4. 身体、翅膀、尾巴、背景像素与原图完全一致，所以不同表情交叉淡入时不会出现身体或背景跳动。

## 姿势差分（透明底，叠在原版静止背景 `plate` 上）

| 文件 | 姿势 | 状态 |
| --- | --- | --- |
| `pose-heart.webp` | 比心（哥特长裙） | 已生成：AI 以 #00FF00 纯色底整图生成 → `tools/lilith_variants_key.py` 抠像 + 去溢色 → 424×632 RGBA |
| `pose-arms.webp` | 抱臂 | **尚未生成**；选择后自动回落到标准站姿表情组 |
| `pose-sit.webp` | 侧坐 | **尚未生成**；选择后自动回落到标准站姿表情组 |

姿势图是重新绘制的全身像，服装为哥特长裙，与原版立绘不是同一张底图，因此只作为可选姿势，不参与自动表情切换。
背景使用原版分层素材里的 `ZhuTianLilithLayers.plate`（去掉角色的静止背景），不做任何动画。

## SHA-256

```
2645ed0364130ee5bb3437fffa2ffb5da9342ed874a5b9791767223132fff72e  neutral.webp
07c4342ab892885c1b9588897f2b60f13f5e176c5dfc2c61999e3423cd53d2b4  pose-heart.webp
144db189e3d622b0b75ea32b5cc6310cb260befaeca7a52ee1ddb7beb8cb1e96  pout.webp
c6c5a1cad30ab637e32676473926f2c0d89fdae61359f8a1a8617b255515f587  sad.webp
292470438a425694de22993ea3517b4cfd1d1d5f6177f7a95f95f4518cacb8be  shy.webp
e3faa6e76c6842be1f8e6f9de06b07f370e972731769959a1cc1f3b8bed30726  smile.webp
b13515492de80a5bfd85cef59389e836fcb0142fd806b47688561feff1150db2  smug.webp
1e05ba12c749193cc0f52e0e6900941483c49b1741b28da1baa13d4d4142e2b3  surprised.webp
9a88ab94ec5002338df8933315b9d7ef7d8af75a5f992f71335c08949e11c6e4  wink.webp
```
