import { NextResponse } from "next/server";

import { assetTypeDefinitions, fetchGenres, resolveDoujinFloor, safeErrorMessage } from "@/lib/fanza";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const floor = await resolveDoujinFloor();
    const genres = await fetchGenres(floor.floorId);

    return NextResponse.json(
      { floor, genres, assetTypes: assetTypeDefinitions() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
