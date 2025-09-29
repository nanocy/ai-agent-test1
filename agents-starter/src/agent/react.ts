// src/agent/react.ts
import { fetchAndExtract } from "../tools/web";

type Step =
  | { type: "action"; tool: "fetch"; args: { url: string }; thought: string }
  | { type: "final"; answer: string; thought?: string };

function systemPrompt() {
  return `
あなたはツールを使えるアシスタントです。ReActの形式で進めます。
各ターンで、厳格なJSONだけを返してください（余計な文字や説明は出さない）。
JSONスキーマは次のどちらかです：

1) 行動する:
{"type":"action","tool":"fetch","args":{"url":"https://..."},"thought":"簡潔な思考"}

2) 最終回答:
{"type":"final","answer":"日本語の答え","thought":"任意"}

制約:
- 余計な出力は禁止。絶対に有効なJSONのみ。
- URLが無ければ最終回答にしてください。
- 最大3ターンで必ずfinalに到達。
  `.trim();
}

async function callOpenAI(
  apiKey: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`OpenAI error: ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}

// ★ここが大事：export を付ける
export async function runReAct(question: string, apiKey: string) {
  const transcript: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `質問: ${question}\n必要なら "fetch" ツールで本文を取得して答えてください。`,
      },
    ];

  for (let turn = 0; turn < 3; turn++) {
    const out = await callOpenAI(apiKey, transcript);

    let step: Step;
    try {
      step = JSON.parse(out) as Step;
    } catch {
      return { answer: "（モデル出力のJSON解析に失敗しました）" };
    }

    if (step.type === "final") {
      return { answer: step.answer };
    }

    if (step.type === "action" && step.tool === "fetch") {
      let observation = "";
      try {
        observation = await fetchAndExtract(step.args.url);
      } catch (e: any) {
        observation = `ERROR: ${e?.message ?? e}`;
      }

      // モデルが出したAction(JSON)を記録 → 観察結果を渡して次ターンへ
      transcript.push({ role: "assistant", content: JSON.stringify(step) });
      transcript.push({
        role: "user",
        content: `Observation: ${observation.slice(0, 4000)}\n\n次は最終回答(JSON)で。`,
      });
      continue;
    }

    return { answer: "（不明なステップが返されました）" };
  }

  return { answer: "（上限ターンに達しました）" };
}