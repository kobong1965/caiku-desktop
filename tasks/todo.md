# 剪辑智能体训练系统 v0.1 任务清单

- [x] Task 1：建立训练数据合同和本地案例仓库
  - Acceptance：参考成品、成对案例、反例、版本和软删除可写入、读取、恢复和审计；原视频不复制、不修改。
  - Verify：schema、路径、哈希、授权、版本与回收站单元测试。
  - Files：`electron/services/editing-training-repository.cjs`、`tests/editing-training-repository.test.cjs`、`docs/剪辑智能体训练数据字典_v0.1.md`。

- [x] Task 2：把用户投喂的参考成品分析成市场带货脚本模式
  - Acceptance：只分析用户主动上传的视频，提取问题钩子、叙事顺序、镜头角色、切点、口播、字幕、音乐和 CTA；不搜索、不自动抓取或下载市场视频，也不把参考商品事实写入当前款号。用户选择云端模型时只请求已配置的模型端点。
  - Verify：固定投喂视频结构黄金测试、本地模型断网测试和外部视频发现禁用测试，覆盖“还有人不懂西裤要怎么穿搭？”模式。
  - Files：`electron/services/editing-case-analysis-service.cjs`、`electron/services/competitor-analysis-service.cjs`、`tests/editing-case-analysis-service.test.cjs`。

- [x] Task 3：读取人工确认的素材分类清单
  - Acceptance：把素材分类板块保存的款号、二级分类和全部人工确认素材完整读取给剪辑智能体；不运行字幕、时长、画质、款号或其他二次筛选，不删除、不降级、不改类。
  - Verify：输入 manifest 中每个分类和素材 ID 必须原样出现在目录结果；测试确认二次筛选函数不会被调用。
  - Files：`electron/services/classified-material-catalog-service.cjs`、`tests/classified-material-catalog-service.test.cjs`。

- [x] Task 4：实现用户投喂案例和脚本模式检索
  - Acceptance：只从用户投喂的本地案例库中按商品类目、脚本意图、镜头角色和风格返回 3–5 个可追溯案例；删除、低分和未授权训练案例不进入正向学习。
  - Verify：本地排序稳定性、案例状态规则、断网运行和无案例安全降级测试。
  - Files：`electron/services/editing-retrieval-service.cjs`、`tests/editing-retrieval-service.test.cjs`。

- [x] Task 5：实现逐句画面绑定和叙事状态机
  - Acceptance：每句文案都有 `sentenceIntent`、目标素材角色、商品证据和选镜理由；按“问题钩子 → 细节证据 → 上身结果 → 使用场景 → 轻 CTA”生成时间线。
  - Verify：跳题、重复结论、无证据文案、叙事倒序和随机填充镜头必须被逻辑门禁拦截。
  - Files：`electron/services/narrative-continuity-service.cjs`、`electron/services/sentence-media-alignment-service.cjs`、`electron/services/ai-editor-service.cjs`、`tests/narrative-continuity-service.test.cjs`。

- [x] Task 6：统一配音、字幕和时间线文本源
  - Acceptance：有口播模式下逐句文案、配音、字幕和画面时段一一对应；纯音乐模式允许不生成口播和字幕。
  - Verify：文本一致性、句级时长、音频时长、字幕区间和时间线边界测试。
  - Files：`electron/services/sentence-media-alignment-service.cjs`、`electron/services/timeline-optimizer-service.cjs`、`tests/sentence-media-alignment-service.test.cjs`。

- [x] Task 7：保存用户反馈版本并隔离千川数据
  - Acceptance：接受、拒绝、换镜、改切点和改文案均保存为新版本和原因；现有千川字段不传给剪辑智能体、不出现在学习报告。
  - Verify：版本回放、回滚、删除和千川数据隔离测试。
  - Files：`electron/services/editing-feedback-service.cjs`、`electron/services/ai-editor-service.cjs`、`electron/main.cjs`、`tests/editing-feedback-service.test.cjs`。

- [x] Task 8：完成“市场脚本学习”和 AI 编排交互
  - Acceptance：脚本管理可拖入用户选择的参考成品、查看分析配方、编辑并设为金标；AI 编排可查看人工确认的分类清单、逐句使用的分类与片段、选镜理由和逻辑门禁；所有用户可添加项都有删除按钮。
  - Verify：拖放、删除、暂停、继续、重试、详情、生成和错误状态 UI 测试。
  - Files：`prototype/v1/index.html`、`prototype/v1/styles.css`、`prototype/v1/app.js`、`electron/preload.cjs`、`tests/prototype-v1.test.cjs`。

- [x] Task 9：完成固定西裤脚本端到端黄金回归
  - Acceptance：固定脚本按问题钩子、细节、上身、场景和 CTA 顺序，从人工确认分类中生成逻辑完整计划；选镜理由可审计，分类素材数量、ID 和类别不被智能体修改。
  - Verify：新黄金测试、分类清单完整性测试、全量单测、静态检查和 v0.1.23 上游高难字幕回归。
  - Files：`tests/fixtures/editing-agent-trousers-golden.json`、`tests/editing-agent-golden.test.cjs`、`scripts/regression-editing-agent.cjs`。

- [x] Task 10：补丁构建和本机连续性验证
  - Acceptance：仅升级补丁版本；原安装目录、桌面快捷方式、用户设置、历史项目、素材盘引用和已验收素材保持不变。
  - Verify：版本、构建哈希、启动、快捷方式目标和用户状态前后对照。
  - Files：`package.json`、`package-lock.json`、`docs/剪辑智能体训练系统验收报告_v0.1.md`。
