import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import * as XLSX from "npm:xlsx";
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

const MsgReaderModule = await import("npm:msgreader");

// 关键修改：根据调试输出确定 MsgReader 的正确路径
const MsgReader: any = MsgReaderModule.default.default; 

// 移除之前的调试日志和自动判断逻辑，因为我们已经找到了正确的路径
// console.log("DEBUG: --- MsgReaderModule Inspection ---");
// console.log("DEBUG: Raw MsgReaderModule:", MsgReaderModule);
// console.log("DEBUG: Type of MsgReaderModule:", typeof MsgReaderModule);
// console.log("DEBUG: Keys in MsgReaderModule:", Object.keys(MsgReaderModule));
// console.log("DEBUG: MsgReaderModule.default:", MsgReaderModule.default);
// console.log("DEBUG: Type of MsgReaderModule.default:", typeof MsgReaderModule.default);
// console.log("DEBUG: Is MsgReaderModule.default callable?", typeof MsgReaderModule.default === 'function');
// console.log("DEBUG: Is MsgReaderModule callable (itself)?", typeof MsgReaderModule === 'function');
// console.log("DEBUG: --- End MsgReaderModule Inspection ---");
// if (typeof MsgReaderModule === 'function') {
//     MsgReader = MsgReaderModule;
//     console.log("DEBUG: Assuming MsgReaderModule itself is the constructor.");
// } else if (typeof MsgReaderModule.default === 'function') {
//     MsgReader = MsgReaderModule.default;
//     console.log("DEBUG: Assuming MsgReaderModule.default is the constructor.");
// } else {
//     console.error("DEBUG: Could not automatically determine MsgReader constructor.");
//     console.error("DEBUG: Please inspect the 'Raw MsgReaderModule' output above and manually assign the correct constructor.");
//     Deno.exit(1);
// }


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
    const body = msgData.body || msgData.bodyHTML || "";

    const pdfAttachments: Uint8Array[] = [];
    if (msgData.attachments && Array.isArray(msgData.attachments)) {
      for (const att of msgData.attachments) {
        if (att.fileName && typeof att.fileName === 'string' && att.fileName.toLowerCase().endsWith(".pdf") && att.content) {
          if (att.content instanceof Uint8Array) {
              pdfAttachments.push(att.content);
          } else if (ArrayBuffer.isView(att.content)) {
              pdfAttachments.push(new Uint8Array(att.content.buffer));
          } else {
              console.warn(`Unexpected content type for PDF attachment: ${typeof att.content}. Skipping.`);
          }
        }
      }
    }

    return { body, pdfAttachments };
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

  // 提供 index.html 文件
  if (pathname === "/" || pathname === "/index.html") {
    try {
      const filePath = new URL("./index.html", import.meta.url).pathname;
      const fileResponse = await serveFile(request, filePath);
      fileResponse.headers.set("Access-Control-Allow-Origin", "*");
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

          // 尝试从非标准格式中提取数据
          try {
            const objectPattern = /\{([^}]+)\}/g;
            const arrayPattern = /\[([^\]]+)\]/g;

            if (objectPattern.test(responseText)) {
              const objects = [];
              let match;
              while ((match = objectPattern.exec(responseText)) !== null) {
                const objStr = `{${match[1]}}`;
                const fixedStr = objStr.replace(/([a-zA-Z0-9_]+):/g, '"$1":').replace(/'/g, '"');
                try {
                  objects.push(JSON.parse(fixedStr));
                } catch (e) {
                  console.warn("Failed to parse object:", e);
                }
              }
              if (objects.length > 0) {
                extractedData = objects;
              } else {
                throw new Error("No valid objects found");
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
                  console.warn("Failed to parse array:", e);
                }
              }
              if (arrays.length > 0) {
                extractedData = arrays;
              } else {
                throw new Error("No valid arrays found");
              }
            } else {
              extractedData = [{ description: responseText }];
            }
          } catch (patternError) {
            extractedData = [{ description: responseText }];
          }
        }

        // 验证提取的数据
        if (extractedData.length === 0) {
          extractedData = [{ description: "No data extracted" }];
        }

        // 生成Excel返回
        const excelData = createExcel(extractedData);

        headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        headers.set("Content-Disposition", "attachment; filename=extracted_data.xlsx");

        return new Response(excelData, { headers });
      } else {
        // For non-.msg files or prompt only, return text directly
        headers.set("Content-Type", "text/plain; charset=utf-8");
        return new Response(responseText, { headers });
      }
    } catch (e) {
      console.error("Server error:", e);
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