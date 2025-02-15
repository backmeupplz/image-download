import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync, mkdirSync, readFileSync } from "fs";
import crypto from "crypto";
import sharp from "sharp";

// Use the current working directory for the images folder.
const imagesDir = `${process.cwd()}/images`;
if (!existsSync(imagesDir)) {
  mkdirSync(imagesDir, { recursive: true });
}

const app = new Hono();

// Enable CORS for all routes (allow any origin)
app.use("*", cors());

// Logger middleware for all requests.
app.use("*", async (c, next) => {
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
  await next();
});

// POST /upload endpoint: Accepts a JSON payload with a base64-encoded PNG image.
app.post("/upload", async (c) => {
  try {
    // Expect JSON like: { "data": "data:image/png;base64,..." } or just the base64 string.
    const { data } = await c.req.json();
    if (!data) {
      return c.text("Missing image data", 400);
    }

    // Remove the data URI prefix if present.
    const base64Image = data.replace(/^data:image\/png;base64,/, "");
    const imageBuffer = Buffer.from(base64Image, "base64");

    // Check if the file size exceeds 10MB.
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
    if (imageBuffer.length > MAX_FILE_SIZE) {
      return c.text("Image file too large, maximum allowed size is 10MB", 400);
    }

    // Convert the PNG image to AVIF using Sharp with lossless conversion for the best quality.
    const avifBuffer = await sharp(imageBuffer)
      .avif({ lossless: true })
      .toBuffer();

    // Compute the SHA-256 hash of the converted AVIF image.
    const hash = crypto.createHash("sha256").update(avifBuffer).digest("hex");

    // Save the converted image as {hash}.avif in the images folder.
    const filename = `${hash}.avif`;
    const filePath = `${imagesDir}/${filename}`;
    Bun.write(filePath, avifBuffer);

    // Return the hash so the client can retrieve the image later.
    return c.json({ hash });
  } catch (err) {
    console.error(err);
    return c.text("Invalid JSON payload or conversion error", 400);
  }
});

// GET /{hash}.avif endpoint: Serves the converted image.
app.get("/:file", (c) => {
  const file = c.req.param("file"); // file should be something like "abcdef123456.avif"
  // Validate that the filename matches the pattern: hexhash + ".avif"
  const match = file.match(/^([0-9a-f]+)\.avif$/);
  if (!match) {
    return c.text("Invalid image URL", 400);
  }
  const hash = match[1];
  const filePath = `${imagesDir}/${hash}.avif`;
  try {
    const imageBuffer = readFileSync(filePath);
    return new Response(imageBuffer, {
      status: 200,
      headers: { "Content-Type": "image/avif" },
    });
  } catch (err) {
    return c.text("Image not found", 404);
  }
});

// Start the server using Bun's built-in serve function.
Bun.serve({
  fetch: app.fetch,
  port: 3000,
});
