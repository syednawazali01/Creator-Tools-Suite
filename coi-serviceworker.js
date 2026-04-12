/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
/*
 * This service worker intercepts all fetch responses and adds the
 * Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy headers
 * required for SharedArrayBuffer (which FFmpeg.wasm needs).
 */
if (typeof window === 'undefined') {
    // Service worker context
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', (e) => {
        if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') return;
        e.respondWith(
            fetch(e.request).then((response) => {
                if (response.status === 0) return response;
                const headers = new Headers(response.headers);
                headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
                headers.set('Cross-Origin-Opener-Policy', 'same-origin');
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                });
            }).catch((e) => console.error(e))
        );
    });
} else {
    // Window context — register the service worker
    (async () => {
        if (!window.crossOriginIsolated) {
            const registration = await navigator.serviceWorker.register(
                window.document.currentScript.src
            );
            if (registration.active && !navigator.serviceWorker.controller) {
                window.location.reload();
            } else if (!registration.active) {
                registration.addEventListener('updatefound', () => {
                    registration.installing.addEventListener('statechange', () => {
                        if (registration.active && !navigator.serviceWorker.controller) {
                            window.location.reload();
                        }
                    });
                });
            }
        }
    })();
}
