import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import * as XLSX from "npm:xlsx";
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

// 关键修改：根据之前的调试输出，MsgReader 构造函数位于 MsgReaderModule.default.default
const MsgReaderModule = await import("npm:msgreader");
const MsgReader: any = MsgReaderModule.default.default;

const apiKey = Deno.env.get("API_KEY");
if (!apiKey) {
  console.error("API_KEY environment variable not set!");
  Deno.exit(1);
}

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
const MODEL_NAME = "gemini-2.0-flash";

// 解析 .msg 文件，返回 { body: string, pdfAttachments: Array<Uint8Array> }
async function parseMsgFile(arrayBuffer: ArrayBuffer): Promise<{ body: string; pdfAttachments: Uint8Array[] }> {
  try {
    const msgReader = new MsgReader(new Uint8Array(arrayBuffer));
    const msgData = msgReader.getFileData();

    let bodyContent = "";

    // 优先使用纯文本 body
    if (typeof msgData.body === 'string' && msgData.body.trim() !== '') {
        bodyContent = msgData.body;
    } 
    // 如果纯文本 body 不存在，尝试使用 bodyHTML 并去除 HTML 标签
    else if (typeof msgData.bodyHTML === 'string' && msgData.bodyHTML.trim() !== '') {
        // 简单地去除 HTML 标签
        bodyContent = msgData.bodyHTML.replace(/<[^>]*>?/gm, '');
        // 移除多余的空白字符并清理
        bodyContent = bodyContent.replace(/\s+/g, ' ').trim();
    }
    // 确保 bodyContent 始终是字符串，即使为空
    bodyContent = String(bodyContent);

    console.log("DEBUG: Parsed MSG body (truncated to 200 chars):", bodyContent.substring(0, 200));
    console.log("DEBUG: Type of Parsed MSG body:", typeof bodyContent);

    const pdfAttachments: Uint8Array[] = [];
    if (msgData.attachments && Array.isArray(msgData.attachments)) {
      for (const att of msgData.attachments) {
        if (att.fileName && typeof att.fileName === 'string' && att.fileName.toLowerCase().endsWith(".pdf") && att.content) {
          if (att.content instanceof Uint8Array) {
              pdfAttachments.push(att.content);
          } else if (ArrayBuffer.isView(att.content)) { 
              // 兼容可能是 TypedArrayView的情况 (如 Buffer)
              pdfAttachments.push(new Uint8Array(att.content.buffer));
          } else {
              console.warn(`DEBUG: Unexpected content type for PDF attachment: ${typeof att.content}. Skipping.`);
          }
        }
      }
    }

    return { body: bodyContent, pdfAttachments };
  } catch (e) {
    console.error("Error in parseMsgFile:", e);
    throw new Error(`Failed to parse MSG file: ${e.message}`);
  }
}

// 用于调用Gemini大模型接口
async function callGemini(parts: any[]): Promise<string> {
  const requestBody = JSON.stringify({
    contents: [{ parts }],
  });

  console.log("DEBUG: Request body being sent to Gemini API (truncated):", JSON.stringify(parts, null, 2).substring(0, 500)); // 打印发送给Gemini的parts数组
  console.log("DEBUG: Full request body size:", requestBody.length, "bytes");

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
    console.error("DEBUG: Gemini API raw error response:", err); // 打印Gemini的原始错误响应
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
    "Access-Control-Allow-Origin": "*", // 允许所有来源的CORS请求
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const { pathname } = new URL(request.url);

  // 提供 index.html 文件
  if (pathname === "/" || pathname === "/index.html") {
    try {
      const filePath = new URL("./index.html", import.meta.url).pathname;
      const fileResponse = await serveFile(request, filePath);
      fileResponse.headers.set("Access-Control-Allow-Origin", "*"); // 确保静态文件响应也包含CORS头
      return fileResponse;
    } catch (e) {
      console.error("Failed to serve index.html:", e);
      headers.set("content-type", "text/plain");
      return new Response("Error serving index.html", { status: 500, headers });
    }
  }

  if (request.method === "POST" && pathname === "/generate") {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      headers.set("content-type", "text/plain");
      return new Response("Content-Type must be multipart/form-data.", { status: 400, headers });
    }

    try {
      const formData = await request.formData();

      const prompt = (formData.get("prompt") as string | null)?.trim() || "";
      const file = formData.get("file") as File | null;

      const parts: any[] = [];
      if (prompt) {
        parts.push({ text: prompt });
      }

      let isMsgFile = false; // Flag to check if the uploaded file is a .msg

      // 如果上传了文件，按类型处理
      if (file) {
        const arrayBuffer = await file.arrayBuffer();

        if (file.name.toLowerCase().endsWith(".msg")) {
          isMsgFile = true; // Set flag to true
          // 解析msg文件
          const { body, pdfAttachments } = await parseMsgFile(arrayBuffer);
          if (body) {
            parts.push({ text: body });
          }

          // 把每个PDF附件也转base64发给模型
          for (const pdfContent of pdfAttachments) {
            const base64pdf = encodeBase64(pdfContent); // pdfContent已是Uint8Array
            parts.push({
              inlineData: {
                mimeType: "application/pdf",
                data: base64pdf,
              },
            });
          }
        } else if (file.type === "application/pdf" || file.type.startsWith("image/")) {
          const base64Data = encodeBase64(new Uint8Array(arrayBuffer));
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
          parts.push({ text: `无法处理的文件类型: ${file.name} (${file.type})` });
        }
      }

      if (parts.length === 0) {
        headers.set("content-type", "text/plain");
        return new Response("Must provide prompt or file.", { status: 400, headers });
      }

      // 调用大模型，期望返回提取的结构化数据JSON字符串
      const responseText = await callGemini(parts);

      // --- Conditional Excel Generation / Text Output ---
      if (isMsgFile) {
        let extractedData: any[] = [];
        try {
          // 先尝试解析标准JSON
          extractedData = JSON.parse(responseText);

          // 验证解析结果是否为数组
          if (!Array.isArray(extractedData)) {
            extractedData = [extractedData];
          }
        } catch (jsonError) {
          console.warn("Failed to parse as JSON for Excel output:", jsonError);

          // 尝试从非标准格式中提取数据 (更宽松的解析)
          try {
            const objectPattern = /\{([^}]+)\}/g;
            const arrayPattern = /\[([^\]]+)\]/g;

            if (objectPattern.test(responseText)) {
              const objects = [];
              let match;
              while ((match = objectPattern.exec(responseText)) !== null) {
                const objStr = `{${match[1]}}`;
                // 尝试修复单引号问题和缺少引号的key
                const fixedStr = objStr.replace(/([a-zA-Z0-9_]+):/g, '"$1":').replace(/'/g, '"');
                try {
                  objects.push(JSON.parse(fixedStr));
                } catch (e) {
                  console.warn("Failed to parse object from pattern:", e);
                }
              }
              if (objects.length > 0) {
                extractedData = objects;
              } else {
                throw new Error("No valid objects found by pattern matching");
              }
            } else if (arrayPattern.test(responseText)) {
              const arrays = [];
              let match;
              while ((match = arrayPattern.exec(responseText)) !== null) {
                const arrStr = `[${match[1]}]`;
                const fixedStr = arrStr.replace(/([a-zA-Z0-9_]+):/g, '"$1":').replace(/'/g, '"');
                try {
                  arrays.push(...JSON.parse(fixedStr));
                } catch (e) {
                  console.warn("Failed to parse array from pattern:", e);
                }
              }
              if (arrays.length > 0) {
                extractedData = arrays;
              } else {
                throw new Error("No valid arrays found by pattern matching");
              }
            } else {
              // 简单文本格式作为 fallback
              extractedData = [{ description: responseText }];
            }
          } catch (patternError) {
            console.error("Error during fallback pattern matching:", patternError);
            // 最后手段：作为纯文本处理
            extractedData = [{ description: responseText }];
          }
        }

        // 验证提取的数据，如果仍然为空则提供默认值
        if (extractedData.length === 0) {
          extractedData = [{ description: "No data extracted or could not be parsed." }];
        }

        // 生成Excel返回
        const excelData = createExcel(extractedData);

        headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        headers.set("Content-Disposition", "attachment; filename=extracted_data.xlsx");

        return new Response(excelData, { headers });
      } else {
        // 对于非 .msg 文件或仅提供 prompt，直接返回文本
        headers.set("Content-Type", "text/plain; charset=utf-8");
        return new Response(responseText, { headers });
      }
    } catch (e) {
      console.error("Server error during /generate request:", e); // 更具体的错误日志
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