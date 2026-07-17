terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # State is local by default (simplest for a solo deploy). To share state or run
  # from CI, uncomment and create the bucket + lock table first, then `terraform init -migrate-state`.
  # backend "s3" {
  #   bucket       = "papyr-tfstate-<account-id>"
  #   key          = "papyr/aws.tfstate"
  #   region       = "eu-central-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "papyr"
      ManagedBy = "terraform"
    }
  }
}
