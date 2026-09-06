<?php

declare(strict_types=1);

namespace SwipePreview;

final class PriceParser
{
    public static function singleValue(string $price): ?int
    {
        $normalized = trim(str_replace(['，', '￥'], [',', '¥'], $price));
        if ($normalized === '') {
            return null;
        }

        // 範囲・下限/上限表現は単一価格として扱わない。
        if (preg_match('/(?:〜|～|~|\-|–|—|以上|以下|から|より|\+|～)/u', $normalized) === 1) {
            return null;
        }

        preg_match_all('/(?<![0-9])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?![0-9])/', $normalized, $matches);
        $numbers = $matches[1] ?? [];
        if (count($numbers) !== 1) {
            return null;
        }

        $digits = str_replace(',', '', (string)$numbers[0]);
        if ($digits === '' || !ctype_digit($digits)) {
            return null;
        }
        $value = (int)$digits;
        return $value >= 0 ? $value : null;
    }

    public static function display(string $rawPrice, ?int $value = null): string
    {
        $raw = trim($rawPrice);
        $single = $value ?? self::singleValue($raw);
        if ($single === null) {
            return $raw;
        }
        return '¥' . number_format($single);
    }
}
