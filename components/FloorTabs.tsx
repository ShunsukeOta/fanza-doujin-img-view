import { FloorSwitcher } from "@/components/FloorSwitcher";
import type { FloorContext, FloorKey } from "@/src/floors";

type Props = {
  activeFloor: FloorKey;
  context: FloorContext;
  overlay?: boolean;
};

// 既存画面の呼び出し互換を保ちつつ、UIはタブではなくFloorSwitcherへ統一する。
export function FloorTabs(props: Props) {
  return <FloorSwitcher {...props} />;
}
