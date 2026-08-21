# FFmpeg runtime

裁库的 Windows 安装版和便携版已经包含 `ffmpeg.exe` 与 `ffprobe.exe`，普通用户不需要单独安装。

两个二进制文件单个均超过 GitHub 普通 Git 的 100 MB 限制，因此不直接提交到源码仓库。若要从源码构建，请将 64 位 Windows FFmpeg 和 FFprobe 放在本目录：

```text
vendor/ffmpeg/ffmpeg.exe
vendor/ffmpeg/ffprobe.exe
```

然后运行 `npm run dist:win`。发布资产中的安装包和便携包属于完整可运行软件，已携带这两个文件。
