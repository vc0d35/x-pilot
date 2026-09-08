# Agent guidance principles

How XPilot talks to the agent. These shape the developer instructions, the page
context, and every tool description and result.

1. **Hints, not scripts.** Give the model where the user is and what they see (the
   "Current page" hint) and let it reason about what the request refers to. Never
   enumerate the phrasings a user might use; the model resolves language better than a
   catalogue can, and every catalogued phrase costs tokens on every turn.
2. **Rules only for policies.** The instructions carry a handful of rules that encode
   safety or intent boundaries (don't move the user's window unless they want to see
   something; verify claims outside X; posting is two-step and never unprompted; user
   decisions are final). Anything that is merely "how to be helpful" is left to the
   model.
3. **Self-describing tools.** Tool descriptions state what a tool does and when it is
   appropriate, in one or two sentences. Results carry explicit status semantics
   (`posted`, `status: 'cancelled_by_user'`, `adapterHealthy`) rather than terse
   strings the model must interpret.
4. **User decisions are outcomes, not errors.** A cancelled confirmation or a declined
   approval returns `success: true` with a status that names the decision. Errors are
   reserved for things that actually failed.
5. **Untrusted text is fenced.** Anything read from the page is wrapped in
   `<page-content untrusted>` and the instructions say it is data, never instructions.
6. **Token economy.** Context is compact and deduplicated: an unchanged view costs one
   line; on-screen posts are excerpts with URLs, and the agent fetches full text only
   when it needs it.
