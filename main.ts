import { GoogleGenerativeAI } from "@google/generative-ai";

// 使用环境变量中的 API 密钥进行身份验证。
const apiKey = 'AIzaSyAdubNkNMtRoQILIQAqOXIg59FZFxBaLnM';

// 设置BASE_URL
const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";

async function handleRequest(request: Request): Promise<Response> {
  const { pathname, origin } = new URL(request.url);

  // 如果是GET请求的根路径，则返回 "API is running"。
  if (request.method === "GET" && pathname === "/") {
    return new Response("API is running", {
      headers: { "content-type": "text/plain" },
    });
  }

  //只处理/generate的POST请求。
  if (request.method === "POST" && pathname === "/generate") {
    try {
      // 从请求正文中提取prompt。
      const { prompt } = await request.json();

      if (!prompt) {
        return new Response("Prompt is required", { status: 400 });
      }

      //调用Gemini API。
      const geminiResponse = await fetch(
        `${BASE_URL}/${API_VERSION}/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
      );

      //检查响应是否成功。
      if (!geminiResponse.ok) {
        console.error("Gemini API error:", geminiResponse.status, geminiResponse.statusText);
        return new Response("Gemini API Error", { status: 500 });
      }

      //解析Gemini API 的响应体，提取文本并将其返回。
      const data = await geminiResponse.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        return new Response("No response from Gemini API", { status: 500 });
      }

      return new Response(text, {
        headers: { "Content-Type": "text/plain" },
      });
    } catch (error) {
      console.error("handleRequest error", error);
      return new Response(JSON.stringify({ error: "handleRequest error" }), { status: 500 });
    }
  }

  //对于所有其他请求，返回 "404 Not Found"。
  return new Response("Not Found", { status: 404 });
}

// 使用提供的处理函数来启动Deno服务器。
Deno.serve({ port: 8000 }, handleRequest);
console.log("Server started on port 8000");
