# Spec: AI 剪辑师 v0.1.8

## Objective

在现有“素材分类 → 素材管理 → 脚本管理 → 素材混剪”流程中增加一个本地 AI 剪辑规划层。用户勾选素材和脚本后，由本机 Ollama `qwen3.5:latest` 根据素材真实能力生成可预览、可确认、可追溯的剪辑决策单；确认后再由现有 FFmpeg 引擎按决策时间线生成成片。

第一版面向服饰带货短视频，解决“脚本要求弹力/下蹲，但候选素材没有对应证据时仍被机械拼接”的问题。

## Assumptions

1. 本地模型通过 `http://127.0.0.1:11434` 的 Ollama API 调用，默认模型为 `qwen3.5:latest`。
2. 现有素材 manifest 与界面内素材对象是候选池来源；AI 只能引用用户本次勾选的素材。
3. AI 负责规划，程序负责校验和执行；AI 不获得 shell、文件写入或任意工具调用权限。
4. 缺少画面证据时，AI 可以提出替代镜头和改词建议，但用户确认前不得改写正式脚本或开始生成。
5. 第一版继续输出 MP4 和质检 JSON，不包含剪映草稿导出。

## Tech Stack

- Electron 43 + Node.js CommonJS
- 原生 HTML/CSS/JavaScript 渲染层
- 本机 Ollama Chat API
- FFmpeg / FFprobe
- Node.js 内置测试运行器 `node:test`

## Commands

- 开发运行：`& 'C:\Program Files\nodejs\npm.cmd' start`
- 语法检查：`& 'C:\Program Files\nodejs\npm.cmd' run check`
- 自动测试：`& 'C:\Program Files\nodejs\npm.cmd' test`
- Windows 打包：`& 'C:\Program Files\nodejs\npm.cmd' run dist:win`

## Project Structure

- `electron/services/ai-editor-service.cjs`：Ollama 调用、素材能力归一化、剪辑计划生成与校验。
- `electron/services/mix-engine.cjs`：按已确认的剪辑时间线执行拼接，保留无计划时的兼容路径。
- `electron/main.cjs`、`electron/preload.cjs`：安全 IPC 边界。
- `prototype/v1/`：AI 剪辑师预览、冲突确认和生成交互。
- `tests/`：计划校验、时间线执行和 IPC/UI 合约测试。
- `docs/`：产品规格与数据合同。

## Code Style

沿用项目的 CommonJS、两空格缩进、短函数与显式错误码风格：

```js
function createEditorError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}
```

模型返回值必须先标准化和校验，再进入业务状态；禁止在渲染进程直接访问 Ollama。

## Data Contract

### Material capability card

每个候选素材在规划请求中至少包含：`id`、`name`、`duration`、`type`、`title`、`tags`、`reason`、`detected`。未知字段以空值处理，不把缺失信息推断成证据。

### Editing plan

```json
{
  "schemaVersion": 1,
  "status": "ready|review|blocked",
  "summary": "本次剪辑策略摘要",
  "decisions": [
    {
      "blockId": "脚本段落 ID",
      "blockName": "段落名称",
      "intent": "段落表达目的",
      "evidenceStatus": "direct|indirect|missing",
      "selectedMaterialIds": ["素材 ID"],
      "unsupportedClaims": ["缺乏画面证据的表达"],
      "rewriteRequired": true,
      "suggestedVoiceText": "建议口播",
      "reason": "选镜理由",
      "timeline": [
        { "materialId": "素材 ID", "sourceStart": 0, "duration": 2.5 }
      ]
    }
  ],
  "warnings": []
}
```

程序必须重新计算 `status`，不能直接信任模型给出的状态。

## Testing Strategy

- 单元测试：模型 JSON 提取、素材 ID 白名单、时间边界、证据缺失、总时长归一化。
- 引擎测试：有计划时严格按时间线生成 concat 清单；无计划时保持旧版兼容行为。
- UI 合约测试：存在“让 AI 剪辑师安排”、规划预览、确认按钮、错误与空状态。
- 回归测试：现有全部测试、`npm run check`、Windows 打包。
- 桌面验收：本地 Ollama 不可用时可理解地失败；可用时生成计划；未经确认不能生成；确认后可以输出成片。

## Boundaries

- Always：限制 Ollama 地址为本机 HTTP(S) 地址；校验所有素材 ID 和时间范围；保留原始脚本；保存计划与成片报告关联。
- Ask first：增加新的第三方依赖；改变固定输出规格；把本地模型换成云端收费模型；新增剪映草稿导出。
- Never：让模型执行命令；把素材内容上传到未配置的远端；在无证据时把推断写成已验证卖点；覆盖原素材。

## Success Criteria

1. 用户勾选素材与脚本后可点击“让 AI 剪辑师安排”，并看到逐段选镜结果。
2. 模型计划只能引用本次勾选的素材，且时间范围不超出素材时长。
3. 脚本提到弹力/下蹲而素材能力卡无对应证据时，计划至少进入 `review`，列出缺失证据和改词建议。
4. 用户未确认计划时，“开始生成”被阻止；确认后混剪引擎按计划顺序和截取时长执行。
5. Ollama 不可用、超时、JSON 无效时给出明确错误，不退化为伪 AI 结果。
6. 成片质检报告记录计划摘要、计划状态、模型与计划生成时间。
7. 所有自动测试和语法检查通过，版本更新为 `0.1.8`。
8. 原位更新后仍从原快捷方式启动，原素材路径和用户状态保留；不上传 GitHub。

## Open Questions

第一版没有阻断实现的问题。后续版本再评估语音转写、逐镜头对标分析、素材能力卡持久化回写和剪映草稿输出。
