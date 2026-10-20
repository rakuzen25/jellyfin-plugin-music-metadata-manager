export function createLinkSession() {
    let nativeLinkScheduled = false,
        nativeLinkRunning = false,
        nativeLinkEpoch = 0,
        nativeLinksActive = true;
    return {
        get nativeLinkScheduled() {
            return nativeLinkScheduled;
        },
        set nativeLinkScheduled(value: typeof nativeLinkScheduled) {
            nativeLinkScheduled = value;
        },
        get nativeLinkRunning() {
            return nativeLinkRunning;
        },
        set nativeLinkRunning(value: typeof nativeLinkRunning) {
            nativeLinkRunning = value;
        },
        get nativeLinkEpoch() {
            return nativeLinkEpoch;
        },
        set nativeLinkEpoch(value: typeof nativeLinkEpoch) {
            nativeLinkEpoch = value;
        },
        get nativeLinksActive() {
            return nativeLinksActive;
        },
        set nativeLinksActive(value: typeof nativeLinksActive) {
            nativeLinksActive = value;
        },
    };
}
