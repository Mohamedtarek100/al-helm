# Owner Control Center — operational notes

Open operational decisions and known limits. These are recorded here rather
than invented in code, so they can be decided deliberately.

## 1. Audit writes are best-effort (by design)

`announcement_send` in `supabase/functions/admin/index.ts` and the
`logAdminAction(...)` calls in the console swallow insert failures.

**Why.** An audit insert failing must never turn a successful announcement send
into a `500`: the owner would retry and the announcement would be delivered
twice, to every account, irreversibly. The same reasoning applies to an export
that already reached the user's disk and a preference change that is already
stored on the device.

**Consequence.** The log can therefore be *incomplete* without anyone noticing.
An audit trail with silent gaps is not evidence. Today the only signal is a
server-side `console.error` line from `safeDbError()`:

```
[admin] audit failed: <database message>
```

**Open decision — monitoring is required before the log is relied on.** Options,
in increasing cost:

1. Alert on the `[admin] audit failed` log line in the Supabase function logs.
2. Add an `audit_degraded` count to the `health` action: run a cheap
   `select count(*) where created_at > now() - interval '1 hour'` and compare
   against recent privileged operations. Surfaced in the Security panel.
3. Write the audit row *in the same transaction* as the operation it describes,
   so both succeed or both fail. This would require moving the send into a
   single RPC; it trades the double-send risk for a log-guarantee.

Not implemented — option 1 needs dashboard configuration, options 2 and 3 change
behaviour and should be reviewed first.

## 2. Audit retention is undecided

`public.admin_audit_log` is append-only and has **no retention policy**. It will
grow without bound.

This is deliberately unresolved. Retention and immutability are in tension:

- **Delete old rows** breaks the append-only property the table exists to keep,
  and the `BEFORE DELETE` trigger actively refuses it.
- **Archive cold partitions to storage** is the compatible option: partition by
  `created_at` month, detach the partition, export it, drop the detached
  partition. Detaching does not fire row DELETE triggers.
- **Keep everything** is acceptable while volume is small — which it currently
  is: entries are written once per console visit and once per announcement send.

**Recommendation:** leave unbounded until the table exceeds a few hundred
thousand rows or storage becomes a concern, then adopt monthly partitioning with
exported cold partitions. Do not add a delete path.

## 3. Immutability boundary

The append-only guarantee holds for **every role this application uses** —
`anon`, `authenticated` and `service_role`. It does not, and cannot, hold against
a PostgreSQL superuser or the table owner: they can disable triggers, revoke
nothing from themselves, or drop the table. This is stated in the migration so
nobody overstates the guarantee. Protection against the owner is a matter of
process (restricted credentials, reviewed access), not of SQL.
