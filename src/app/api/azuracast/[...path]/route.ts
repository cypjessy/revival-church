import { NextResponse } from "next/server";
import { addCorsHeaders, handleCorsPreflight } from "@/lib/cors";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ path: string[] }>;
}

export async function OPTIONS(req: Request) {
  return handleCorsPreflight(req);
}

async function proxy(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const base = process.env.NEXT_PUBLIC_AZURACAST_URL || "";
  const apiKey = process.env.NEXT_PUBLIC_AZURACAST_API_KEY || "";
  const pathStr = path.join("/");
  const urlStr = `${base}/api/${pathStr}${new URL(req.url).search}`;

  const method = req.method;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const incomingAuth = req.headers.get("authorization");
  if (incomingAuth) {
    headers["Authorization"] = incomingAuth;
  } else if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.text();
  }

  try {
    const res = await fetch(urlStr, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    const resText = await res.text();
    return addCorsHeaders(new NextResponse(resText, {
      status: res.status,
      statusText: res.statusText,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
      },
    }), req);
  } catch (err) {
    console.error("[AzuraCast Proxy]", err);
    return addCorsHeaders(NextResponse.json(
      { error: "AzuraCast proxy failed" },
      { status: 502 }
    ), req);
  }
}

export async function GET(req: Request, ctx: Ctx) { return proxy(req, ctx); }
export async function POST(req: Request, ctx: Ctx) { return proxy(req, ctx); }
export async function PUT(req: Request, ctx: Ctx) { return proxy(req, ctx); }
export async function DELETE(req: Request, ctx: Ctx) { return proxy(req, ctx); }
export async function PATCH(req: Request, ctx: Ctx) { return proxy(req, ctx); }
