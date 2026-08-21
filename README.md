# 裁库 0.1.11

裁库是一款本地优先的 Windows 抖音带货素材生产工具，素材、脚本、任务与混剪工程共享同一份本机状态：

1. 原素材处理：读取原视频、镜头切分、合并低于 2 秒的边界、字幕区处理、按内容分类归档。
2. 素材管理：按款号、批次和分类查找、预览、加入工程或删除派生素材。
3. 剪辑成片：选择素材、脚本、配音和音乐，批量生成固定 1080×1920、9:16 的 MP4。
4. 脚本管理：维护段落、口播文案、镜头分类和时长，并执行离线风险词预检。
5. AI 剪辑师：根据脚本要求和已勾选素材的真实视觉证据制定逐段剪辑方案，不为缺失镜头补造证据。
6. 任务板：统计今天分类的批次、原视频、可用素材、待复核与异常任务。

每个批次会保存 `manifest.json`，每条成片会保存独立质检 JSON。原视频默认复制归档且永不覆盖。

## 本地运行

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' start
```

## 验证与打包

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run check
& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\npm.cmd' run dist:win
```

字幕处理包含主体重构裁切、多帧像素遮罩、字幕带柔化和保留原画面四种策略。复杂移动贴纸或遮挡主体的文字必须人工复核；软件不会把待复核素材直接标为可投放。

## 软件更新与下载

从 0.1.11 起，可以在“设置 > 软件更新”中检查、下载并安装 GitHub 最新正式版本。软件不会自动下载，只有用户确认后才开始；安装沿用原位置并保留本机数据。

正式安装包和便携包位于 [GitHub Releases](https://github.com/kobong1965/caiku-desktop/releases)。Windows 用户推荐下载文件名为 `caiku-desktop-setup-版本号.exe` 的安装版。

## 源码构建说明

GitHub 普通 Git 不允许提交超过 100 MB 的单文件，因此 `vendor/ffmpeg` 下的两个二进制仅随安装包和便携包分发。源码构建前请按 [FFmpeg runtime](vendor/ffmpeg/README.md) 放置 Windows 64 位 `ffmpeg.exe` 与 `ffprobe.exe`。
