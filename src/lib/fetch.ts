/**
 * `fetch` is a method of the global object, and the browser enforces that.
 *
 * Storing it on an instance and calling it as `this.fetchImpl(url)` makes the
 * receiver the instance rather than the window, and Chrome rejects that with
 *
 *     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * The failure happens BEFORE any request leaves the browser, which is what
 * made it so hard to see: the network tab is empty, there is no CORS error,
 * no status code, nothing upstream to check. It looked exactly like three
 * public feeds going down at once.
 *
 * Node does not care - its `fetch` is a plain function - so unit tests with an
 * injected fake and a smoke test run under Node both passed while the live
 * page failed every time. That gap is the whole lesson here: an integration
 * whose only exercise is a Node test has not been exercised in a browser.
 *
 * Binding at the boundary fixes it once for every caller. Injected fakes bind
 * harmlessly, so tests are unaffected.
 */
export function boundFetch(impl: typeof fetch = globalThis.fetch): typeof fetch {
  return impl.bind(globalThis)
}
