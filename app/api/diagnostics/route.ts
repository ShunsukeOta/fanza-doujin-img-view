import { NextRequest, NextResponse } from "next/server";

import { resolveDoujinFloor, safeErrorMessage } from "@/lib/fanza";
import { scanCatalogDiagnostics } from "@/lib/fanza-catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const genreId = (request.nextUrl.searchParams.get("genre_id") ?? "").trim();

  try {
    const floor = await resolveDoujinFloor();
    const diagnostics = await scanCatalogDiagnostics(floor, genreId);
    return NextResponse.json(diagnostics, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
