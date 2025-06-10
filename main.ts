import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import MsgReader from "npm:msgreader";
import * as XLSX from "npm:xlsx";

const apiKey = Deno.env.get("API_KEY");
if (!apiKey) {
  console.error("API_KEY environment variable not set!");
  Deno.exit(1);
}

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
const MODEL_NAME = "gemini-1.5-flash";

// 解析 .msg 文件，返回 { body: string, pdfAttachments: Array<Uint8Array> }
async function parseMsgFile(arrayBuffer: ArrayBuffer): Promise<{ body: string; pdfAttachments: Uint8Array[] }> {
  const msgReader = new MsgReader(new Uint8Array(arrayBuffer));
  const msgData = msgReader.getFileData();
  const body = msgData.body || msgData.bodyHTML || "";

  const pdfAttachments: Uint8Array[] = [];
  if (msgData.attachments && Array.isArray(msgData.attachments)) {
    for (const att of msgData.attachments) {
      if (att.fileName && att.fileName.toLowerCase().endsWith(".pdf") && att.content) {
        pdfAttachments.push(att.content);
      }
    }
  }

  return { body, pdfAttachments };
}

// 用于调用Gemini大模型接口
async function callGemini(parts: any[]): Promise<string> {
  const requestBody = JSON.stringify({
    contents: [{ parts }],
  });

  const res = await fetch(
    `${BASE_URL}/${API_VERSION}/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API Error: ${res.status} ${res.statusText} ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// 生成Excel二进制
function createExcel(data: any[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Uint8Array(wbout);
}

export async function handleRequest(request: Request): Promise<Response> {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/") {
    headers.set("content-type", "text/plain");
    return new Response("API is running. POST multipart/form-data to /generate.", { headers });
  }

  if (request.method === "POST" && pathname === "/generate") {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      headers.set("content-type", "text/plain");
      return new Response("Content-Type must be multipart/form-data.", { status: 400, headers });
    }

    try {
      const formData = await request.formData();

      const prompt = (formData.get("prompt") as string) || "";
      const file = formData.get("file") as File | null;

      const parts: any[] = [];
      if (prompt.trim()) {
        parts.push({ text: prompt });
      }

      // 如果上传了文件，按类型处理
      if (file && file instanceof File) {
        const arrayBuffer = await file.arrayBuffer();

        if (file.name.endsWith(".msg")) {
          // 解析msg文件
          const { body, pdfAttachments } = await parseMsgFile(arrayBuffer);
          if (body) {
            parts.push({ text: body });
          }

          // 把每个PDF附件也转base64发给模型
          for (const pdfContent of pdfAttachments) {
            const base64pdf = encodeBase64(pdfContent.buffer);
            parts.push({
              inlineData: {
                mimeType: "application/pdf",
                data: base64pdf,
              },
            });
          }
        } else if (file.type === "application/pdf" || file.type.startsWith("image/")) {
          const base64Data = encodeBase64(arrayBuffer);
          parts.push({
            inlineData: {
              mimeType: file.type,
              data: base64Data,
            },
          });
        } else if (file.type.startsWith("text/")) {
          const decoder = new TextDecoder();
          parts.push({ text: decoder.decode(arrayBuffer) });
        } else {
          // 其他类型按需处理
        }
      }

      if (parts.length === 0) {
        headers.set("content-type", "text/plain");
        return new Response("Must provide prompt or file.", { status: 400, headers });
      }

      // 调用大模型，期望返回提取的结构化数据JSON字符串
      const responseText = await callGemini(parts);

      // 假设大模型返回JSON数组 [{ product, model, quantity, price }, ...]
      let extractedData: any[] = [];
      try {
        extractedData = JSON.parse(responseText);
      } catch {
        // 返回文本格式，尝试简单包装为数组
        extractedData = [{ description: responseText }];
      }

      // 生成Excel返回
      const excelData = createExcel(extractedData);

      headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      headers.set("Content-Disposition", "attachment; filename=extracted_data.xlsx");

      return new Response(excelData, { headers });
    } catch (e) {
      console.error(e);
      headers.set("content-type", "text/plain");
      return new Response(`Server error: ${e.message}`, { status: 500, headers });
    }
  }

  headers.set("content-type", "text/plain");
  return new Response("Not Found", { status: 404, headers });
}

// 直接启动服务器
Deno.serve({ port: 8000 }, handleRequest);
console.log(`Server with ${MODEL_NAME} started on http://localhost:8000`);