# Frontend security review

The Compose command center binds to loopback. The demo API is reachable through its same-origin Nginx service. Nginx drops inbound planner-token headers and rejects unexpected host names. The browser bundle, runtime responses and local storage contain no planner token. The optional local approval route reads the token on the server and delegates to the original state machine, which revalidates saved plans. A same-origin request also needs an allowlisted Origin, request marker and fetch-site check. Browser confirmation identifies the planner and explains that release supersedes the active plan.

Origin and fetch metadata protect the browser boundary. They can be forged by a direct client and provide no independent user authentication. Run interactive mode only on the trusted local machine or behind independently configured authentication and authorization. Planner identity is a demonstration attribution string. The frontend cannot turn local controls into production authorization.

Read-only mode denies job submission, approval, release and other writes. Copilot uses deterministic tools without persist or upstream provider calls in this mode. Configure the frontend origin allowlist explicitly when adapting to a public synthetic showcase. Use isolated synthetic data and restrict direct API access. The separate legacy API containers retain existing behavior and should not be published to public clients.

The frontend renders API strings as React text and does not inject HTML. CSP limits scripts and connections to the hosting origin. Inline styles support the timeline and charts. Scenario inputs receive native form checks, typed request validation and backend constraint checking. Saved job IDs support safe refresh, and a single idempotency key is reused when submission delivery is uncertain.

Security coverage includes cross-origin denial, direct planner-token endpoint denial in console mode, read-only mutation denial, copilot non-persistence in read-only mode, unauthorized release, valid explicit approval and release, and immutable source payload checks.
