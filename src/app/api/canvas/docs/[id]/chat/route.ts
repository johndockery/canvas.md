import { NextRequest, NextResponse } from "next/server";

const CANVAS_API =
  process.env.CANVAS_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production"
    ? `http://localhost:${process.env.PORT || 8080}`
    : "http://localhost:1235");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await fetch(`${CANVAS_API}/api/docs/${id}/chat`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${CANVAS_API}/api/docs/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to persist message" }, { status: 500 });
  }
}
