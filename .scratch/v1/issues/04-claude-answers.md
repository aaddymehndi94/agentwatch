# 04: Claude answers — approve/deny and question answers from the phone

**What to build:** A Claude `PermissionRequest` opens a Request and is held. The phone shows the exact command/tool, or the question with its options. Approve/Deny/answer from the app, or from Android notification buttons, reaches the daemon as a sealed command. The daemon verifies it and the hook returns the decision. A local answer at the terminal closes the Request ("answered at laptop") and releases the hook. The phone sees delivered/applied/expired.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] protocol: command envelope + sealed body; daemon-side verify (ts ±5 min and after daemon start, nonce, request open); tests
- [ ] cli: hold/release for PermissionRequest (phone decision, PostToolUse same tool+input, Stop/UserPromptSubmit/SessionEnd, timeout, daemon restart); dedupe Notification(permission_prompt); AskUserQuestion answers via updatedInput.answers
- [ ] relay: request.open/close, `/api/commands` + status, command routing to the source WS, ack
- [ ] app: Request card (permission + question, multi-select) with clear Approve/Deny; status feedback; SW notification actions (Android)
- [ ] plugin: PermissionRequest hook timeout verified to accept a long value (~12 h)
- [ ] E2E with fixtures: phone allow → hook stdout is the allow JSON; local PostToolUse → hook released empty + Request answered_locally
