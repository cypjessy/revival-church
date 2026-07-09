import { NextRequest, NextResponse } from "next/server";
import { uploadToBunny } from "@/lib/bunny";

// CORS headers for Capacitor cross-origin requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const churchId = (formData.get("church_id") as string) || "general";
    const category = (formData.get("category") as string) || "gallery";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Allowed: JPG, PNG, WEBP, GIF, AVIF` },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 10MB` },
        { status: 400 }
      );
    }

    // Generate a unique storage path
    const ext = file.name.split(".").pop() || "jpg";
    const uuid = crypto.randomUUID();
    const storagePath = `churches/${churchId}/${category}/${uuid}.${ext}`;

    // Read file as buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to BunnyCDN
    const result = await uploadToBunny(buffer, storagePath, file.type);

    // Try to get image dimensions by reading binary headers (best-effort)
    let width = 0;
    let height = 0;
    try {
      if (file.type === "image/png" && buffer.length >= 24) {
        // PNG: IHDR chunk at bytes 16-23
        width = buffer.readUInt32BE(16);
        height = buffer.readUInt32BE(20);
      } else if (file.type === "image/jpeg") {
        // JPEG: scan for SOF0 marker (0xFF 0xC0) which contains dimensions
        for (let i = 0; i < buffer.length - 9; i++) {
          if (buffer[i] === 0xFF && buffer[i + 1] === 0xC0) {
            height = buffer.readUInt16BE(i + 5);
            width = buffer.readUInt16BE(i + 7);
            break;
          }
        }
      } else if (file.type === "image/webp" && buffer.length >= 30) {
        // WEBP: VP8/VP8L header contains dimensions
        if (buffer.toString("ascii", 12, 16) === "VP8 " && buffer.length >= 30) {
          width = buffer.readUInt16LE(26) & 0x3FFF;
          height = buffer.readUInt16LE(28) & 0x3FFF;
        } else if (buffer.toString("ascii", 12, 16) === "VP8L" && buffer.length >= 25) {
          const bits = buffer.readUInt32LE(21);
          width = (bits & 0x3FFF) + 1;
          height = ((bits >> 14) & 0x3FFF) + 1;
        }
      }
    } catch {
      // Non-fatal — dimensions default to 0
    }

    return NextResponse.json({
      cdn_url: result.cdnUrl,
      file_size: file.size,
      width,
      height,
      storage_path: storagePath,
    }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
