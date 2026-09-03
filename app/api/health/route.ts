import { NextResponse } from "next/server";

import { environmentStatus, resolveDoujinFloor, safeErrorMessage } from "@/lib/fanza";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const env = environmentStatus();

  if (!env.DMM_API_ID || !env.DMM_AFFILIATE_ID) {
    return NextResponse.json(
      {
        ok: false,
        env,
        error: "必要な環境変数が設定されていません。値そのものはこのAPIでは返しません。",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const floor = await resolveDoujinFloor();
    return NextResponse.json(
      {
        ok: true,
        env,
        upstream: "reachable",
        floor: {
          site: floor.siteCode,
          service: floor.serviceCode,
          floor: floor.floorCode,
          floorId: floor.floorId,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, env, upstream: "error", error: safeErrorMessage(error) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
