# Vendored dependencies

`boeschj-claude-jsonl-*.tgz` — packed from the sibling `claude-jsonl` repo so end-user
installs resolve without npm access. Refresh after a schema change:

```bash
pnpm --dir ../claude-jsonl pack --pack-destination "$(pwd)/vendor"
```

then update the `file:vendor/...` specifier in `package.json` if the version changed.
Replace this with a published `@boeschj/claude-jsonl` npm dependency once it ships.
