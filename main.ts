// server.ts
// 导入Deno标准库的base64编码工具
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
// 注意：虽然导入了，但代码逻辑仍然使用fetch，未使用SDK
// import { GoogleGenerativeAI } from "@google/generative-ai"; 

// *** 1. 安全起见，恢复从环境变量读取，不要硬编码！ ***
const apiKey = 'AIzaSyAdubNkNMtRoQILIQAqOXIg59FZFxBaLnM';
if (!apiKey) {
    console.error("API_KEY environment variable not set!");
    Deno.exit(1);
}

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
// *** 2. 使用支持多模态（包括PDF和图片）的模型 ***
const MODEL_NAME = "gemini-1.5-flash"; // 或 gemini-1.5-pro, gemini-pro-vision(仅图片)


async function handleRequest(request: Request): Promise<Response> {
  // 添加 CORS Headers 以便浏览器端可以跨域调用
   const headers = new Headers({
    "Access-Control-Allow-Origin": "*", // 允许所有来源，生产环境请限制
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
   });
    
  // 处理 CORS 预检请求
  if (request.method === "OPTIONS") {
       return new Response(null, { status: 204, headers: headers });
  }
    
  const { pathname } = new URL(request.url);

  // GET / 检查
  if (request.method === "GET" && pathname === "/") {
     headers.set("content-type", "text/plain");
    return new Response("API is running. POST to /generate with multipart/form-data.", { headers });
  }

  //只处理/generate的POST请求。
  if (request.method === "POST" && pathname === "/generate") {
    
     const contentType = request.headers.get("content-type");
     // *** 3. 检查 Content-Type 是否为 multipart/form-data ***
     if (!contentType || !contentType.includes("multipart/form-data")) {
        headers.set("content-type", "text/plain");
        return new Response("Content-Type must be multipart/form-data. Fields: 'prompt' (text) and/or 'file' (image/pdf).", { status: 400, headers: headers });
      }

    try {
       // *** 4. 解析 formData 而不是 json ***
       const formData = await request.formData();
       // 获取文本字段 'prompt'
       const prompt = formData.get("prompt") as string | null;
        // 获取文件字段 'file'
       const file = formData.get("file") as File | null; // 注意类型断言

       const parts: any[] = [];

       // 添加文本 part
       if (prompt) {
          parts.push({ text: prompt });
       }

       // *** 5. 处理文件并添加 inlineData part ***
        if (file && file instanceof File) {
           if (!file.type) {
               headers.set("content-type", "text/plain");
               return new Response("Cannot determine file MIME type from upload.", { status: 400, headers: headers });
           }
            // 读取文件内容到 ArrayBuffer
           const fileBuffer = await file.arrayBuffer();
           // 将 ArrayBuffer 编码为 Base64 字符串
           const base64Data = encodeBase64(fileBuffer);
           
           // 构建 Gemini inlineData 结构
           parts.push({
               inlineData: {
                    mimeType: file.type, // 例如: image/png, image/jpeg, application/pdf
                    data: base64Data,
               }
            });
             console.log(`Received file: ${file.name}, type: ${file.type}, size: ${file.size}`);
        }
        
        // 确保至少有一个 part (prompt 或 file)
       if(parts.length === 0){
          headers.set("content-type", "text/plain");
           return new Response("Form must contain either a 'prompt' field or a 'file' field (or both).", { status: 400, headers: headers });
       }
       console.log("Sending parts count:", parts.length , "Prompt:", prompt ? "Yes": "No", "File:", file? "Yes": "No");


      // *** 6. 构建包含动态 parts 的请求体 ***
      const requestBody =  JSON.stringify({
            contents: [{ parts: parts }], // 使用动态构建的 parts 数组
            // 可选：添加安全设置或生成配置
            // safetySettings: [...],
            // generationConfig: { temperature: 0.7 } 
       });
        
      //调用Gemini API。
      const geminiResponse = await fetch(
        `${BASE_URL}/${API_VERSION}/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: requestBody,
        },
      );

      //检查响应是否成功。
      if (!geminiResponse.ok) {
        // 打印更详细的错误信息
        const errorBody = await geminiResponse.text(); 
        console.error("Gemini API error:", geminiResponse.status, geminiResponse.statusText, errorBody);
         headers.set("content-type", "application/json");
        return new Response(JSON.stringify({error: "Gemini API Error", details: errorBody}), { status: 500, headers: headers });
      }

      //解析Gemini API 的响应体，提取文本并将其返回。
      const data = await geminiResponse.json();
       // console.log("Gemini Raw Response:", JSON.stringify(data, null, 2)); // 调试用
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
         // 检查是否有内容因安全原因被阻止
         const finishReason = data.candidates?.[0]?.finishReason;
         let errMsg = "No text response from Gemini API";
         if(finishReason && finishReason !== 'STOP'){
             errMsg = `Gemini API blocked content. Reason: ${finishReason}`;
              console.warn(errMsg, JSON.stringify(data?.promptFeedback));
         } else {
            console.error("No valid text candidate found in Gemini response:", JSON.stringify(data));
         }
          headers.set("content-type", "text/plain");
          // 如果是因为安全原因，返回400或特定状态，否则500
          const status = (finishReason && finishReason !== 'STOP') ? 400 : 500;
         return new Response(errMsg, { status: status , headers: headers});
      }
	  
      headers.set("Content-Type", "text/plain; charset=utf-8");
      return new Response(text, { headers: headers });

    } catch (error) {
      console.error("handleRequest error", error);
       headers.set("content-type", "application/json");
      // 捕获 formData 解析错误等
      return new Response(JSON.stringify({ error: "Server Error", message: error.message }), { status: 500 , headers: headers});
    }
  }

  //对于所有其他请求，返回 "404 Not Found"。
   headers.set("content-type", "text/plain");
  return new Response("Not Found", { status: 404, headers: headers });
}

// 使用提供的处理函数来启动Deno服务器。
Deno.serve({ port: 8000 }, handleRequest);
console.log(`Server with ${MODEL_NAME} started on http://localhost:8000`);
console.log("POST to /generate with multipart/form-data ('prompt' and/or 'file')");