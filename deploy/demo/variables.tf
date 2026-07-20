variable "demo_domain" {
  description = "Domain the demo is served on (e.g. demo.papyr.example.com). An A record must point at the server's IP."
  type        = string
}

variable "ssh_public_key" {
  description = "Path to the SSH public key allowed to log in."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "server_type" {
  description = "Hetzner server type. CX22 (2 vCPU / 4 GB) handles demo-size compiles for ~€4/mo."
  type        = string
  default     = "cx22"
}

variable "location" {
  description = "Hetzner location."
  type        = string
  default     = "fsn1"
}

variable "repo_url" {
  description = "Public git URL the box clones and runs. Must be public (or reachable with no credentials) at apply time."
  type        = string
  default     = "https://github.com/trahloff/Papyr.git"
}
