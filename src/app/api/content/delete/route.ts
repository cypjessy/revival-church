import { NextRequest, NextResponse } from "next/server";
import { deleteFromBunny } from "@/lib/bunny";

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { storage_paths } = body as { storage_paths: string[] };

    if (!storage_paths || !Array.isArray(storage_paths) || storage_paths.length === 0) {
      return NextResponse.json({ error: "No storage_paths provided" }, { status: 400 });
    }

    const results = await Promise.allSettled(
      storage_paths.map((path) => deleteFromBunny(path))
    );

    const succeeded = results.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;
    const failed = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)
    ).length;

    return NextResponse.json({
      deleted: succeeded,
      failed,
      total: storage_paths.length,
    });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
  }
}
