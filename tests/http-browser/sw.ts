// Dev-only API/browser tests do not register a service worker on the user's origin.
export const registerSW = () => () => Promise.resolve()
