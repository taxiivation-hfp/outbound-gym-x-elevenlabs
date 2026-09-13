"use client";

import { useSyncExternalStore } from "react";

/**
 * The sidebar's test number: the 9 digits typed after +61. Kept in
 * sessionStorage, so it follows the person from page to page and is gone when
 * the tab closes — the next person at a shared demo doesn't inherit it. The
 * call queue sends it with each call; `/api/call` checks it and, when it is
 * blank, CALL_OVERRIDE_NUMBER stands.
 */
const KEY = "retention-router.test-number";
const EVENT = "retention-router:test-number";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function readTestNumber(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeTestNumber(value: string) {
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Not remembered past this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useTestNumber(): string {
  return useSyncExternalStore(subscribe, readTestNumber, () => "");
}

/** The shape `/api/call` accepts, checked here only to colour the field; the route decides. */
export function looksLikeMobile(digits: string): boolean {
  return /^4\d{8}$/.test(digits) || /^04\d{8}$/.test(digits);
}
