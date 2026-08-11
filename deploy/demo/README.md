# Aldine public demo box

A throwaway ~€4/mo Hetzner server that runs the full Aldine stack with **auth
off** and a **nightly wipe** (volumes destroyed at 04:00 UTC). Point launch
traffic at it; keep nothing on it.

## Bring it up

```bash
cd deploy/demo
export HCLOUD_TOKEN=...          # Hetzner Cloud API token (create in the console)
terraform init
terraform apply -var demo_domain=demo.aldine.example.com
# → prints the server IP
```

Then create an **A record** for `demo_domain` pointing at that IP. Caddy
provisions the TLS certificate automatically on first request. The first boot
builds the TeX Live image on the box, so allow ~20–30 minutes before the demo
responds (`curl https://<demo_domain>/api/health`).

Note: the box clones the repo anonymously, so the repo must be **public**
before `terraform apply` (or pass `-var repo_url=` pointing at a mirror).

## Tear it down

```bash
terraform destroy
```

That's the whole lifecycle. If launch traffic melts the default cx23
(2 vCPU / 4 GB), bump `-var server_type=cx33` (4 vCPU / 8 GB) and re-apply. The
wipe timer makes the box stateless by design, so resizing costs nothing but the
rebuild.

Note that this is deliberately below the 8 GB the [single-VPS
runbook](../README.md) asks for: it is a demo with auth off and a nightly wipe,
not a place to keep work.
