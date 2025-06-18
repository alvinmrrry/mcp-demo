import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import * as XLSX from "npm:xlsx";
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

// .msg file parsing logic has been removed.

const apiKey = Deno.env.get("API_KEY");
if (!apiKey) {
  console.error("API_KEY environment variable not set!");
  Deno.exit(1);
}

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
const MODEL_NAME = "gemini-1.5-flash-latest"; // Using a recent model

// 用于调用Gemini大模型接口
async function callGemini(parts: any[]): Promise<string> {
  const requestBody = JSON.stringify({
    contents: [{ parts }],
    // Added a system instruction to encourage JSON output for file processing
    "systemInstruction": {
        "parts": {
            "text": "When a file (PDF or image) is provided, analyze its content and extract structured data. Always format the output as a JSON array of objects. Each object should represent an item found in the document. If no structured data is found, return an empty JSON array []."
        }
    }
  });

  console.log("DEBUG: Request body being sent to Gemini API (truncated):", JSON.stringify(parts, null, 2).substring(0, 500));
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
    console.error("DEBUG: Gemini API raw error response:", err);
    throw new Error(`Gemini API Error: ${res.status} ${res.statusText} ${err}`);
  }

  const data = await res.json();
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  // Clean up potential markdown formatting from the response
  return responseText.replace(/```json\n|```/g, "").trim();
}

// 生成Excel二进制
function createExcel(data: any[]): Uint8Array {
  // Ensure data is always an array, even if a single object is passed
  const sheetData = Array.isArray(data) ? data : [data];
  if (sheetData.length === 0) {
      sheetData.push({ status: "No data could be extracted from the document." });
  }
  const ws = XLSX.utils.json_to_sheet(sheetData);
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

      // Flag to determine if we should generate an Excel file for the output
      let shouldGenerateExcel = false;

      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const fileType = file.type;

        if (fileType === "application/pdf" || fileType.startsWith("image/")) {
          shouldGenerateExcel = true; // PDFs and Images will trigger Excel generation
          const base64Data = encodeBase64(new Uint8Array(arrayBuffer));
          parts.push({
            inlineData: {
              mimeType: fileType,
              data: base64Data,
            },
          });
        } else if (fileType.startsWith("text/")) {
          const decoder = new TextDecoder();
          parts.push({ text: decoder.decode(arrayBuffer) });
        } else {
            headers.set("content-type", "text/plain");
            return new Response(`Unsupported file type: ${file.name} (${file.type}). Please upload a PDF, image, or text file.`, { status: 400, headers });
        }
      }

      if (parts.length === 0) {
        headers.set("content-type", "text/plain");
        return new Response("Must provide a text prompt or a file.", { status: 400, headers });
      }

      const responseText = await callGemini(parts);

      // --- Conditional Output: Generate Excel for PDF/Image, otherwise return text ---
      if (shouldGenerateExcel) {
        let extractedData: any[] = [];
        try {
          // Attempt to parse the response as JSON
          extractedData = JSON.parse(responseText);
        } catch (jsonError) {
          console.warn("Gemini response was not valid JSON. Treating as plain text.", jsonError);
          // If JSON parsing fails, wrap the text in a default structure for Excel
          extractedData = [{ result: responseText }];
        }

        // Generate and return the Excel file
        const excelData = createExcel(extractedData);
        headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        headers.set("Content-Disposition", "attachment; filename=extracted_data.xlsx");
        return new Response(excelData, { headers });

      } else {
        // For text prompts or text files, return the raw text response
        headers.set("Content-Type", "text/plain; charset=utf-8");
        return new Response(responseText, { headers });
      }

    } catch (e) {
      console.error("Server error during /generate request:", e);
      headers.set("content-type", "text/plain");
      return new Response(`Server error: ${e.message}`, { status: 500, headers });
    }
  }

  headers.set("content-type", "text/plain");
  return new Response("Not Found", { status: 404, headers });
}

// Start the server
Deno.serve({ port: 8000 }, handleRequest);
console.log(`Server with ${MODEL_NAME} started on http://localhost:8000`);