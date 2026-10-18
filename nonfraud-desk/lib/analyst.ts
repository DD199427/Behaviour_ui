"use client"

import { useSyncExternalStore } from "react"

const KEY = "nonfraud-analyst"
const EVENT = "nonfraud-analyst"

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange)
  window.addEventListener(EVENT, onStoreChange)
  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener(EVENT, onStoreChange)
  }
}

function snapshot(): string {
  return localStorage.getItem(KEY) || "analyst"
}

export function useAnalystName(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, snapshot, () => "analyst")
  const setName = (value: string) => {
    localStorage.setItem(KEY, value.slice(0, 40))
    window.dispatchEvent(new Event(EVENT))
  }
  return [name, setName]
}
