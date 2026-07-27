/**
 * Key matching shared by the panel and the markdown overlay.
 *
 * pi's `matchesKey` handles named keys and modifier combinations; a
 * single-character binding such as "s" or "c" is compared literally, because
 * that is what the terminal delivers.
 */

import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

export function keyHit(data: string, key: KeyId): boolean {
	return key.length === 1 ? data === key : matchesKey(data, key);
}
