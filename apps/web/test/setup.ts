// jsdom does no layout, so it has no scrolling: its window.scrollTo only logs "Not implemented".
// The app's <ScrollRestoration /> calls it on every navigation, so make it a quiet no-op (tests spy on it).
window.scrollTo = () => {}
