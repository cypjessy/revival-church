import { NextRequest, NextResponse } from "next/server";
import { deleteFromBunny } from "@/lib/bunny";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function DELETE(req: NextRequest) {
  try {
    const { storage_paths } = await req.json();

    if (!storage_paths || !Array.isArray(storage_paths) || storage_paths.length === 0) {
      return NextResponse.json(
        { error: "storage_paths must be a non-empty array" },
        { status: 400 }
      );
    }

    const results = await Promise.allSettled(
      storage_paths.map((path: string) => deleteFromBunny(path))
    );

    const deleted = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({
      success: true,
      deleted,
      failed,
      total: storage_paths.length,
    }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("Delete error:", err);
    return NextResponse.json(
      { error: err.message || "Delete failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
