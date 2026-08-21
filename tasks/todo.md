# 裁库 0.1.11 自动更新与发布任务清单

- [ ] Task 1：冻结安装、数据与 GitHub 发布基线
  - Acceptance：记录当前版本、安装路径、快捷方式目标、状态文件哈希、GitHub 账号和目标仓库。
  - Verify：PowerShell 路径/哈希检查与 `gh auth status`。

- [ ] Task 2：先写更新服务和 UI 合同测试
  - Acceptance：测试覆盖状态映射、IPC、更新设置页、进度与按钮可用性。
  - Verify：新增测试先失败，再由实现使其通过。

- [ ] Task 3：实现主进程更新控制器与安全 IPC
  - Acceptance：仅正式包可检查；用户确认后下载；下载完成后才允许安装；错误可重试。
  - Verify：更新服务单元测试、`npm run check`。

- [ ] Task 4：实现“设置 > 软件更新”界面
  - Acceptance：版本、来源、状态、进度和三段操作清晰；最小窗口无溢出；固定页脚隐藏。
  - Verify：UI 合同测试与桌面实测截图。

- [ ] Task 5：配置 0.1.11 与 GitHub provider
  - Acceptance：包版本为 0.1.11，构建配置指向公开仓库并生成 `latest.yml`。
  - Verify：检查 `package.json`、`package-lock.json` 和构建产物。

- [ ] Task 6：全量回归与 Windows 打包
  - Acceptance：语法检查、全部测试通过；安装版、便携版、blockmap、`latest.yml` 齐全。
  - Verify：`npm run check`、`npm test`、`npm run dist:win`。

- [ ] Task 7：公开源码并创建 GitHub Release
  - Acceptance：公开仓库可访问；默认分支包含可公开源码；`v0.1.11` 为正式发布并有完整资产。
  - Verify：`gh repo view`、`gh release view`、公开 URL 请求。

- [ ] Task 8：原位安装与数据连续性验收
  - Acceptance：原路径与快捷方式不变；状态文件哈希和业务数据计数不变；0.1.11 可启动。
  - Verify：安装前后哈希、快捷方式目标、运行进程与界面版本检查。

- [ ] Task 9：交付下载链接
  - Acceptance：Release 页面和安装版直链可匿名访问，用户可直接下载。
  - Verify：最终 URL HEAD/GET 验证。
