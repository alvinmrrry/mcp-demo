import { Application, Router, Context, isHttpError, Status } from "https://deno.land/x/oak@v16.1.0/mod.ts";

// --- Type Definitions (Remain the same) ---
interface GenerateRequestBody {
    prompt?: string;
}

interface GenerateResponseBody {
    generated_text: string;
}

interface ErrorResponseBody {
    error: string;
}

// --- Placeholder Text Generation (Remains the same, assuming no Node-specific APIs) ---
async function generateTextFromApi(prompt: string): Promise<string> {
    console.log(`Simulating AI generation for prompt: "${prompt.substring(0, 50)}..."`);
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay

    if (prompt.toLowerCase().includes("error")) {
        throw new Error("Simulated API error during generation.");
    }
    return `Generated text for prompt: "${prompt}"`;
}

// --- Oak Application Setup ---
const app = new Application();
const router = new Router();

// --- Environment Variables ---
// Use Deno.env.get() - returns string | undefined
const portEnv = Deno.env.get("PORT");
const PORT = portEnv ? parseInt(portEnv, 10) : 3000; // Default to 3000 if not set or invalid

// --- Middleware ---

// Logger Middleware
app.use(async (ctx: Context, next: () => Promise<unknown>) => {
    console.log(`[${new Date().toISOString()}] ${ctx.request.method} ${ctx.request.url}`);
    await next(); // Pass control to the next middleware
    // Log response status after request is handled
    console.log(`[${new Date().toISOString()}] Response status: ${ctx.response.status}`);
});

// Error Handling Middleware (Place early to catch subsequent errors)
app.use(async (ctx: Context, next: () => Promise<unknown>) => {
    try {
        await next(); // Attempt to process the request using subsequent middleware/routes
    } catch (err) {
        console.error("Error caught by middleware:", err); // Log the full error

        let statusCode: Status = Status.InternalServerError;
        let errorMessage = "Internal Server Error";

        if (isHttpError(err)) { // Check if it's an Oak HTTP error (like BadRequest)
            statusCode = err.status;
            errorMessage = err.message;
        } else if (err instanceof Error) { // Handle generic errors
            // Keep default 500, but use the error's message if available
            errorMessage = `An internal server error occurred: ${err.message}`;
        } else {
            errorMessage = `An unknown internal error occurred.`;
        }

        ctx.response.status = statusCode;
        ctx.response.body = { error: errorMessage } satisfies ErrorResponseBody; // Use satisfies for type checking
        ctx.response.type = "json"; // Explicitly set response type
    }
});

// --- Routes defined on the Router ---

// Health Check Route
router.get('/', (ctx: Context) => {
    ctx.response.status = Status.OK; // Use Oak's Status enum
    ctx.response.body = { status: "API is running" };
    // Oak automatically sets Content-Type to application/json for objects
});

// Text Generation Route
router.post('/generate', async (ctx: Context) => {
    // --- Input Validation ---
    if (!ctx.request.hasBody) {
        ctx.throw(Status.BadRequest, "Request body is missing.");
    }

    let prompt: string | undefined;
    try {
        // Oak parses JSON body automatically if Content-Type is correct
        // Use .json() which returns a Promise
        const body: GenerateRequestBody = await ctx.request.body.json();
        prompt = body.prompt;

        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
             // Use ctx.throw to trigger the error handling middleware
            ctx.throw(Status.BadRequest, "Bad Request: Missing or invalid 'prompt' in request body.");
        }

        console.info(`Received prompt: '${prompt.substring(0, 50)}...'`);

        // --- Call Generation Logic (inside try block already) ---
        const generatedText = await generateTextFromApi(prompt);
        console.info("Successfully generated content (placeholder).");

        // --- Send Success Response ---
        ctx.response.status = Status.OK;
        ctx.response.body = { generated_text: generatedText } satisfies GenerateResponseBody;
        ctx.response.type = "json";

    } catch (parseError) {
        // Handle JSON parsing errors specifically if needed, otherwise caught by general error handler
        if (parseError instanceof SyntaxError) {
             ctx.throw(Status.BadRequest, `Bad Request: Invalid JSON format. ${parseError.message}`);
        } else if (!isHttpError(parseError) && parseError instanceof Error) {
            // This catches the 'Simulated API error' or other non-HTTP errors
            // Let the general error middleware handle logging and response formatting
            throw parseError; // Re-throw to be caught by the error middleware
        } else {
            throw parseError; // Re-throw HTTP errors (like the ones from ctx.throw)
        }
    }
    // Note: No explicit 'return' needed like in Express handlers after sending response.
    // Oak manages the response flow. Throwing errors is the way to stop execution and signal failure.
});

// --- Use Router Middleware ---
app.use(router.routes()); // Apply the defined routes
app.use(router.allowedMethods()); // Optional: Handles OPTIONS requests, 405 Method Not Allowed, etc.

// --- Start Server ---
console.log(`Server starting on http://localhost:${PORT}...`);
// Add event listener for better startup feedback (optional)
app.addEventListener("listen", ({ hostname, port, secure }) => {
    console.log(
        `Server listening on: ${secure ? "https://" : "http://"}${hostname ?? "localhost"}:${port}`
    );
});

await app.listen({ port: PORT }); // Use await for listen