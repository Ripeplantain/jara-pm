"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function OfflineBanner() {
  const offline = useSyncExternalStore(
    subscribe,
    () => !window.navigator.onLine,
    () => false,
  );
  if (!offline) return null;
  return <div className="offline-banner" role="status">You are offline. Changes will retry when your connection returns.</div>;
}
