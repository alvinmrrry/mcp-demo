import "https://deno.land/std@0.218.2/dotenv/load.ts";

async function runEmbeddingTest() {
  const embeddingEndpoint = "https://alvinmrrry-openai-gemi-53.deno.dev/embeddings";
  const inputText = "The quick brown fox jumps over the lazy dog.";
  const apiKey = Deno.env.get("API_KEY");

  console.log(`向 Gemini 云服务发送文本用于 embedding：${inputText}`);

  try {
    const response = await fetch(embeddingEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`, // 添加 API 密钥
      },
      body: JSON.stringify({
        model: "text-embedding-004", // 或者其他你支持的 embedding 模型
        input: inputText,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("从 Gemini 云服务获取到嵌入数据:");
      console.log(data);
      if (data.data && data.data.length > 0) {
        console.log("返回的 embedding 向量:");
        console.log(data.data[0].embedding);
      }
    } else {
      console.error("从 Gemini 云服务获取失败，错误代码", response.status);
    }
  } catch (error) {
    console.error("请求失败", error);
  }
}

runEmbeddingTest();
