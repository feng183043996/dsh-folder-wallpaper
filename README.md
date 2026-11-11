# dsh-folder-wallpaper

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**本地文件夹照片壁纸轮播**插件：指定一个相册目录，插件会把它作为整个界面的背景自动轮播，同时把界面面板调成半透明毛玻璃，让照片透出来。

和其它壁纸插件相比，它只做一件事：**读你本机已有的文件夹**。不需要上传，不需要 Wallpaper Engine，也不需要联网。

## 特性

- **文件夹轮播**：读取指定目录下的 `jpg / jpeg / png / webp / avif / gif`，按文件名自然排序（`IMG_2.jpg` 排在 `IMG_10.jpg` 前面），定时交叉淡入淡出。
- **毛玻璃面板**：把界面面板的不透明度统一改成可调值，并加 `backdrop-filter` 模糊；浅色/深色主题各自适配（分别基于 `--dsw-static-neutral-bluish-00/950`），切换主题不需要重载。
- **两次曝光都可用**：照片层在 `z-index: -1`，所有面板、弹窗、toast 仍然在它上面，不会被覆盖。
- **左下角快速面板（🖼）**：即时预览——拖动滑块立刻看到效果，可多选要轮播的照片；点「保存」才把当前值写回插件配置。
- **插件配置页**：在「插件」页里为该插件提供完整的配置表单（文件夹路径、间隔、透明度、模糊、压暗、填充方式、是否打乱、白名单），保存后插件自动重载。
- **无遥测**：不发送任何请求，不写日志；诊断输出只在页面里 `localStorage.setItem("dsh-wallpaper-debug", "1")` 之后打印到浏览器控制台。

## 安装

**方式一（推荐）**：在 DSH 的「插件 → 发现」里搜索 `dsh-folder-wallpaper`。如果你的市场还没有索引源，可以添加 `https://gcore.jsdelivr.net/gh/AAAMECHANIC/dsh-plugin-market@main/index.json`（社区索引）。

**方式二**：装到你的 profile 里，然后重启 DSH：

```powershell
pnpm -C "$env:USERPROFILE\.dsh\profiles\desktop" add dsh-folder-wallpaper
```

并在该 profile 的 `dsh.profile.bundles` 里加上 `dsh-folder-wallpaper`。

装好后刷新页面（Ctrl+F5）。左下角会出现 🖼 按钮；「插件」页里会出现该插件的配置。

## 配置

全部配置都在「插件 → 照片壁纸轮播」里（也可以在 `cordis.patch.yml` 里写）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `directory` | `~/Pictures` | 照片文件夹的绝对路径，只读这一层（不递归子目录） |
| `intervalMs` | `20000` | 轮播间隔，1000–3600000 毫秒 |
| `transitionMs` | `1600` | 淡入淡出时长，0–10000 毫秒 |
| `surfaceAlpha` | `0.28` | 面板不透明度 0–1：越小照片越清楚，越大文字越好读 |
| `panelBlur` | `4` | 面板毛玻璃模糊半径 0–40 像素 |
| `dim` | `0.1` | 照片上黑色压暗遮罩 0–0.8 |
| `blurPx` | `0` | 照片自身模糊 0–40 像素 |
| `fit` | `cover` | `cover` 铺满裁切 / `contain` 完整显示 |
| `shuffle` | `false` | 每次加载随机打乱顺序 |
| `enabled` | `[]` | 只轮播这些文件名；留空表示全部 |

调参建议：文字不好读就先加 `surfaceAlpha`（0.35–0.5）和 `dim`（0.15–0.25），别急着加 `panelBlur`——模糊太大照片会变成一块糊掉的色块，反而看不出是照片。

## 图片尺寸

浏览器会解码原图。手机拍的照片常见 4000×3000、单张 10 MB 以上，一张就够占几十 MB 内存。**建议先把照片压到长边 1920–2560 的缩略图**再放进目录（每张 200–500 KB 即可），轮播会明显更顺。插件不会替你改文件。

## 安全

- 只读你配置的那一个目录，且只读一层。
- 图片 URL 会先做 `path.resolve` 规范化再做前缀校验，`..` 越界返回 403。
- 三条路由（manifest / image / settings）都经过宿主 `connection.requestRejection()`，也就是浏览器已经持有的签名 cookie；别的站点拿不到你的照片。
- 不发起任何出站请求，不收集任何数据。

## 已知限制

- 目录不递归；想看子文件夹请把它们都指到一个目录里。
- 视频壁纸不支持（只有静态图）。
- 从 Wallpaper Engine 库读图也不支持——那是另一个插件的活。Windows 桌面版如果自绘标题栏区域没有透出来，需要额外处理，欢迎提 issue。

## 许可

MIT
