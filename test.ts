import "https://deno.land/std@0.218.2/dotenv/load.ts";

async function runTest() {
  const geminiEndpoint = "https://alvinmrrry-openai-gemi-53.deno.dev/chat/completions";
  const prompt = "Why is the sky blue?";
  const apiKey = Deno.env.get("API_KEY");

  console.log(`向gemini云服务发送问题：${prompt}`);

  try {
    const response = await fetch(geminiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`, // 添加 API 密钥
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("从gemini 云服务获取到数据:");
      console.log(data);
      if (data.choices && data.choices.length > 0) {
        console.log("答案是");
        console.log(data.choices[0].message.content);
      }
    } else {
      console.error("从Gemini云服务获取失败， 错误代码", response.status);
    }
  } catch (error) {
    // 网络错误，或者JSON解析失败
    console.error("请求失败", error);
  }
}

runTest();