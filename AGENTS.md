<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Preserve the imported S4M domain core and original French screen structure; adapt transport and routing at boundaries because this minimizes migration drift.
- Use Lovable Cloud authentication and data access for runtime behavior; keep the imported Hono/Drizzle server only as migration reference because the deployed runtime is TanStack Start.
