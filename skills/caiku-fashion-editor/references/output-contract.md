# 剪辑计划输出合同

返回一个 JSON 对象：

```json
{
  "confidence": 0.9,
  "conflicts": [],
  "summary": "字符串",
  "warnings": [],
  "decisions": [
    {
      "blockId": "脚本段落 ID",
      "intent": "本段画面目的",
      "evidenceStatus": "direct | indirect | missing",
      "selectedMaterialIds": ["候选素材 ID"],
      "unsupportedClaims": [],
      "rewriteRequired": false,
      "suggestedVoiceText": "",
      "reason": "选镜与证据理由",
      "timeline": [
        { "materialId": "候选素材 ID", "sourceStart": 0, "duration": 2 }
      ]
    }
  ]
}
```

约束：

- `confidence` 为 0 到 1 的计划可执行置信度，不是商品卖点置信度。
- `conflicts` 只列结构冲突、素材 ID 冲突、时长冲突或无法同时满足的要求。
- 每个脚本段落恰好对应一个 decision。
- 所有字符串数组只能包含字符串。
- 不得输出候选列表以外的素材 ID。
